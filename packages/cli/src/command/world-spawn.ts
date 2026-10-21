import type { CommandError } from "./outcome";
import { outsideError } from "./outcome";
import type { SpawnOptions, Spawned, World } from "./world";
import type { OutputStream } from "./world-limits";
import {
  byteCounter,
  longestTimerMs,
  outputLimitReached,
  programLimits,
  timeLimitReached,
} from "./world-limits";

/** The outside failure for a program that is not installed: kind `outside`, exit 3. */
export function notInstalled(program: string): CommandError {
  return outsideError(`${program} is not installed or not on PATH`);
}

/**
 * The program that Bun found in no PATH folder, if `error` is the error Bun.spawn throws then. On
 * Bun 1.4.0 that error has code ENOENT, the program as its `path`, and no `syscall`, because no
 * program started. Any other error gives undefined: a working folder that does not exist also has
 * code ENOENT and the program as its `path`, but `syscall` "posix_spawn".
 */
function notOnPath(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT" &&
    !("syscall" in error) &&
    "path" in error &&
    typeof error.path === "string"
  ) {
    return error.path;
  }
  return undefined;
}

/**
 * Starts a program with Bun, with the World's `env` plus the call's. A program that is not on PATH
 * is an outside failure that names it; any other error that Bun throws stays as it is.
 */
function startWithBun(commandLine: readonly string[], options: SpawnOptions, env: World["env"]) {
  try {
    return Bun.spawn([...commandLine], {
      cwd: options.cwd,
      // The whole environment, as the World shows it, plus the call's variables (ADR-0015). Bun
      // 1.4.0 starts the program without a variable whose value is undefined. That is how a call
      // removes one (ADR-0016; note 12, section 1.7).
      env: { ...env, ...options.env },
      stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
      stderr: "pipe",
      // Its own process group, so a stop reaches every program it starts (note 10, section 2).
      detached: true,
    });
  } catch (error) {
    const program = notOnPath(error);
    throw program === undefined ? error : notInstalled(program);
  }
}

/** Whether `error` is the error process.kill throws for a process or group that does not exist. */
function isGone(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

/**
 * Whether `error`, from a signal to the process group that `pid` leads, means that nothing in the
 * group is left to stop. ESRCH: the group is gone. EPERM: nothing is left to stop when the leader
 * has ended too, reaped or not; an EPERM from the leader itself is a real refusal. The reason: on
 * EPERM, macOS still holds the group, but no program in it can take a signal from this process. It
 * skips the programs that have ended and are not yet reaped, and a leader that still ran as this
 * user would take the signal. A program of another user that is left would refuse a SIGKILL too.
 */
function nothingLeftToStop(error: unknown, pid: number): boolean {
  if (isGone(error)) {
    return true;
  }
  if (!(error instanceof Error && "code" in error && error.code === "EPERM")) {
    return false;
  }
  try {
    // Signal 0 to the leader itself: an ended leader that is not yet reaped still answers.
    process.kill(pid, 0);
    return true;
  } catch (leaderError) {
    // A leader that Bun has reaped is gone, and has ended too.
    return isGone(leaderError);
  }
}

/**
 * The stop of the process group that `pid` leads, sent once however often `stop` is called:
 * SIGTERM to every process in it, then SIGKILL after the grace. A group with nothing left to stop
 * is not an error; any other failure to send a signal rejects `failed`, because the group may still
 * run. `dropKillIfGone` cancels the SIGKILL once nothing in the group is left to stop, so nothing
 * waits for the grace.
 */
function groupStop(pid: number, graceMs: number) {
  const failed = Promise.withResolvers<never>();
  let killer: ReturnType<typeof setTimeout> | undefined;
  function send(signal: "SIGTERM" | "SIGKILL"): void {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!nothingLeftToStop(error, pid)) {
        failed.reject(error);
      }
    }
  }
  return {
    failed: failed.promise,
    stop(): void {
      if (killer === undefined) {
        send("SIGTERM");
        killer = setTimeout(() => {
          send("SIGKILL");
        }, graceMs);
      }
    },
    dropKillIfGone(): void {
      if (killer === undefined) {
        return;
      }
      try {
        // Signal 0 checks the group and sends nothing. macOS checks it as it checks SIGKILL, so
        // when nothing in the group can take signal 0, the SIGKILL would reach nothing either.
        process.kill(-pid, 0);
      } catch (error) {
        if (nothingLeftToStop(error, pid)) {
          clearTimeout(killer);
        }
      }
    },
  };
}

/**
 * Reads one output stream as text and counts its bytes. Past `maxBytes` it calls `onOverLimit` and
 * stops reading; the text it returns is then cut short, and the call that reads it rejects. A
 * character split across two reads stays whole, as with Bun's own `text()`. Bun's `maxBuffer` is
 * not used: it overshoots, and its stop looks like any other SIGTERM (note 10, section 2).
 */
async function readOutput(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onOverLimit: () => void,
): Promise<string> {
  const decoder = new TextDecoder();
  const pastLimit = byteCounter(maxBytes);
  let text = "";
  for await (const chunk of stream) {
    if (pastLimit(chunk)) {
      onOverLimit();
      // Leaving the loop cancels the stream, so nothing more is read or kept.
      return text;
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Runs a program with Bun, with no shell, in its own process group, and collects its exit code and
 * output as text. The program gets `env`, the World's env, plus the call's. With no stdin text, the
 * program gets no stdin, so it can never wait on the user's terminal. At the time limit, past the
 * output limit, or when the signal aborts, it stops the whole group. Bun's own `timeout` and
 * `signal` reach only the program, and a program it started keeps the pipes open, so the call
 * would wait for it (note 10, section 2).
 */
export async function spawnWithBun(
  commandLine: readonly string[],
  options: SpawnOptions,
  graceMs: number,
  env: World["env"],
): Promise<Spawned> {
  const { signal } = options;
  // An aborted signal starts no program, and the call keeps the signal's reason.
  signal?.throwIfAborted();
  const { timeoutMs, maxOutputBytes } = programLimits(options);
  const child = startWithBun(commandLine, options, env);
  const group = groupStop(child.pid, graceMs);
  // The first limit the program reaches: the call rejects with it once the group has stopped.
  let reached: CommandError | undefined;
  function stopAt(limit: CommandError): void {
    reached ??= limit;
    group.stop();
  }
  function read(stream: OutputStream): Promise<string> {
    return readOutput(child[stream], maxOutputBytes, () => {
      stopAt(outputLimitReached(commandLine, stream, maxOutputBytes));
    });
  }
  const timer = setTimeout(
    () => {
      stopAt(timeLimitReached(commandLine, timeoutMs));
    },
    Math.min(timeoutMs, longestTimerMs),
  );
  signal?.addEventListener("abort", group.stop, { once: true });
  try {
    // The pipes close when the last program in the group that holds them ends.
    const [stdout, stderr, code] = await Promise.race([
      Promise.all([read("stdout"), read("stderr"), child.exited]),
      group.failed,
    ]);
    // A program stopped by the signal or at a limit has no result to give.
    signal?.throwIfAborted();
    if (reached !== undefined) {
      throw reached;
    }
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", group.stop);
    group.dropKillIfGone();
  }
}
