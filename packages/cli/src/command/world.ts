import type { CommandError } from "./outcome";
import { outsideError } from "./outcome";
import { sameWords } from "./words";

/** The limits that every outside program gets unless the call changes them. */
export const limits = {
  /** A program's time limit: 5 minutes. */
  programMs: 5 * 60 * 1000,
} as const;

/**
 * How to run a spawned program: its working folder, the text it reads on stdin, the signal that
 * stops it, the variables added to its environment, and its time limit.
 */
export type SpawnOptions = {
  cwd?: string;
  stdin?: string;
  signal?: AbortSignal;
  /**
   * Variables added to the environment the program gets, such as GIT_TERMINAL_PROMPT=0. A variable
   * here replaces one of the same name. runCommand removes only the World's env secrets from its
   * messages, so no secret goes here.
   */
  env?: Readonly<Record<string, string>>;
  /**
   * The program's time limit in milliseconds, a positive number: `limits.programMs` when unset. A
   * limit past about 24 days, the longest a timer holds, acts as about 24 days.
   */
  timeoutMs?: number;
};

/** How a spawned program ended: its exit code, and its output as text. */
export type Spawned = { code: number; stdout: string; stderr: string };

/** The outside world a command reaches. Commands reach programs, the network and env only here. */
export type World = {
  /** The repo folder the command acts on; the working folder by default. */
  root: string;
  /** The environment variables. */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Runs a program, with no shell, and returns its exit code and output. The program gets the whole
   * environment plus the call's `env`. At its time limit, the program and every program it started
   * stop, and the call rejects with an outside failure that names the program and the limit. When
   * the signal aborts, they stop too, and the call rejects with the signal's reason, as fetch does.
   * A program that is not installed rejects with an outside failure that names it.
   */
  spawn: (commandLine: readonly string[], options?: SpawnOptions) => Promise<Spawned>;
  /** Sends an HTTP request. */
  fetch: typeof globalThis.fetch;
  /** The current time. */
  now: () => Date;
};

/** The outside failure for a program that is not installed: kind `outside`, exit 3. */
function notInstalled(program: string): CommandError {
  return outsideError(`${program} is not installed or not on PATH`);
}

/**
 * A command line, short, for a message: the program and its first argument, then "..." when more
 * words follow, such as `gh api ...`. The progress step that ran the program tells which call it was.
 */
function shortCommandLine(commandLine: readonly string[]): string {
  const shown = commandLine.slice(0, 2).join(" ");
  return commandLine.length > 2 ? `${shown} ...` : shown;
}

/** A count and its unit in words: 1 minute, 90 seconds. */
function countOf(count: number, unit: string): string {
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
}

/** A time in words, in its largest whole unit: 5 minutes, 90 seconds, 1500 milliseconds. */
function durationOf(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return countOf(ms / 60_000, "minute");
  }
  if (ms >= 1000 && ms % 1000 === 0) {
    return countOf(ms / 1000, "second");
  }
  return countOf(ms, "millisecond");
}

/**
 * A spawn call's time limit: its own, or `limits.programMs`. A limit that is not a positive number
 * is a bug in the caller, not an outside failure, so it throws a plain Error.
 */
function programTimeLimit(options: SpawnOptions): number {
  const timeoutMs = options.timeoutMs ?? limits.programMs;
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `a program's time limit is a positive number of milliseconds, not ${timeoutMs}`,
    );
  }
  return timeoutMs;
}

/**
 * The outside failure for a program stopped at its time limit, kind `outside`, exit 3: it names the
 * program and the limit. realWorld and fakeWorld both give it, so a test of a limit sees the real
 * failure.
 */
function timeLimitReached(commandLine: readonly string[], timeoutMs: number): CommandError {
  return outsideError(
    `${shortCommandLine(commandLine)} ran longer than ${durationOf(timeoutMs)} and was stopped`,
  );
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
 * Starts a program with Bun. A program that is not on PATH is an outside failure that names it;
 * any other error that Bun throws stays as it is.
 */
function startWithBun(commandLine: readonly string[], options: SpawnOptions) {
  try {
    return Bun.spawn([...commandLine], {
      cwd: options.cwd,
      // The whole environment, as the World shows it, plus the call's variables (ADR-0015).
      env: { ...Bun.env, ...options.env },
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

/** Whether the process group that `pid` leads still has a process in it. */
function groupExists(pid: number): boolean {
  try {
    // Signal 0 checks that the group exists, and sends nothing.
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isGone(error);
  }
}

/**
 * The stop of the process group that `pid` leads, sent once however often `stop` is called:
 * SIGTERM to every process in it, then SIGKILL after the grace. A group that is already gone is not
 * an error; any other failure to send a signal rejects `failed`, because the group may still run.
 * `dropKillIfGone` cancels the SIGKILL once the group is gone, so nothing waits for the grace.
 */
function groupStop(pid: number, graceMs: number) {
  const failed = Promise.withResolvers<never>();
  let killer: ReturnType<typeof setTimeout> | undefined;
  function send(signal: "SIGTERM" | "SIGKILL"): void {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!isGone(error)) {
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
      if (killer !== undefined && !groupExists(pid)) {
        clearTimeout(killer);
      }
    },
  };
}

/** The longest delay a timer holds: setTimeout fires at once for a longer one. */
const longestTimerMs = 2 ** 31 - 1;

/**
 * Runs a program with Bun, with no shell, in its own process group, and collects its exit code and
 * output as text. With no stdin text, the program gets no stdin, so it can never wait on the user's
 * terminal. At the time limit, or when the signal aborts, it stops the whole group. Bun's own
 * `timeout` and `signal` reach only the program, and a program it started keeps the pipes open, so
 * the call would wait for it (note 10, section 2).
 */
async function spawnWithBun(
  commandLine: readonly string[],
  options: SpawnOptions,
  graceMs: number,
): Promise<Spawned> {
  const { signal } = options;
  // An aborted signal starts no program, and the call keeps the signal's reason.
  signal?.throwIfAborted();
  const timeoutMs = programTimeLimit(options);
  const child = startWithBun(commandLine, options);
  const group = groupStop(child.pid, graceMs);
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      group.stop();
    },
    Math.min(timeoutMs, longestTimerMs),
  );
  signal?.addEventListener("abort", group.stop, { once: true });
  try {
    // The pipes close when the last program in the group that holds them ends.
    const [stdout, stderr, code] = await Promise.race([
      Promise.all([child.stdout.text(), child.stderr.text(), child.exited]),
      group.failed,
    ]);
    // A program stopped by the signal or at its time limit has no result to give.
    signal?.throwIfAborted();
    if (timedOut) {
      throw timeLimitReached(commandLine, timeoutMs);
    }
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", group.stop);
    group.dropKillIfGone();
  }
}

/** What realWorld takes: the grace between SIGTERM and SIGKILL when it stops a program. */
export type RealWorldOptions = {
  /** 5 seconds when unset; a test of a program that ignores SIGTERM sets less. */
  graceMs?: number;
};

/** The grace between SIGTERM and SIGKILL when realWorld stops a program: 5 seconds. */
const defaultGraceMs = 5 * 1000;

/**
 * The real World: the working folder, the process environment, Bun's spawn, the global fetch and
 * the clock. It is the one place in the CLI that touches the process for these.
 */
export function realWorld(options: RealWorldOptions = {}): World {
  const graceMs = options.graceMs ?? defaultGraceMs;
  return {
    root: process.cwd(),
    env: Bun.env,
    spawn(commandLine, spawnOptions = {}) {
      return spawnWithBun(commandLine, spawnOptions, graceMs);
    },
    fetch: globalThis.fetch,
    now() {
      return new Date();
    },
  };
}

/**
 * A scripted answer to a spawn call: the command line it matches, word for word, and its end. A
 * `missing` program is not installed, and a program with a `limit` reached it: the call rejects as
 * realWorld's does, and `answer` is unused.
 */
export type ScriptedSpawn = {
  commandLine: readonly string[];
  answer?: Partial<Spawned>;
  missing?: boolean;
  /** "time": the program ran past the call's time limit, or past `limits.programMs`. */
  limit?: "time";
};

/**
 * A scripted answer to a fetch call: the method (GET when unset) and the URL it matches, and the
 * response's status, body and headers.
 */
export type ScriptedFetch = {
  method?: string;
  url: string;
  answer?: { status?: number; body?: string; headers?: Record<string, string> };
};

/** What fakeWorld builds a fake World from. Each field is optional. */
export type FakeWorldOptions = {
  root?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  spawn?: readonly ScriptedSpawn[];
  fetch?: readonly ScriptedFetch[];
};

/**
 * One spawn or fetch call that a fake World received. The log leaves out the signal: it says how a
 * call is cancelled, not what the call asks for.
 */
export type WorldCall =
  | ({ kind: "spawn"; commandLine: readonly string[] } & Omit<SpawnOptions, "signal">)
  | { kind: "fetch"; method: string; url: string };

/** A fake World, and the log of every spawn and fetch call it received, in order. */
export type FakeWorld = World & { calls: readonly WorldCall[] };

/** A fake World's root when the options give none: a folder that does not exist. */
const defaultRoot = "/fake-world/repo";

/** A fake World's time when the options give none. */
const defaultTime = new Date("2026-01-01T00:00:00.000Z");

/** Removes the first entry that matches from the script and returns it; undefined for none. */
function take<Entry>(script: Entry[], matches: (entry: Entry) => boolean): Entry | undefined {
  const index = script.findIndex(matches);
  return index === -1 ? undefined : script.splice(index, 1)[0];
}

/** Whether a scripted fetch matches a request: the same method, and the same URL in normal form. */
function fetchMatches(entry: ScriptedFetch, request: Request): boolean {
  return (
    (entry.method ?? "GET").toUpperCase() === request.method.toUpperCase() &&
    new URL(entry.url).href === request.url
  );
}

/**
 * A fake World for tests. `spawn` and `fetch` answer from the scripts in the options: a call takes
 * the first unused scripted answer that matches it, so each answer answers one call. A call with no
 * answer left fails with an error that names the call. A call whose signal is aborted rejects with
 * the signal's reason, as the real one does. `calls` logs every call, in order.
 *
 * With no root, the root is a folder that does not exist, so a test that forgets to give one fails
 * instead of writing in the working folder. With no env, env is empty; with no time, the clock
 * stands at 2026-01-01T00:00:00Z.
 */
export function fakeWorld(options: FakeWorldOptions = {}): FakeWorld {
  const time = options.now ?? defaultTime;
  const calls: WorldCall[] = [];
  const spawnScript = [...(options.spawn ?? [])];
  const fetchScript = [...(options.fetch ?? [])];

  function answerSpawn(commandLine: readonly string[], spawnOptions: SpawnOptions = {}): Spawned {
    const { signal, ...logged } = spawnOptions;
    calls.push({ kind: "spawn", commandLine: [...commandLine], ...logged });
    // A cancelled call rejects, as the real one does, and uses up no scripted answer.
    signal?.throwIfAborted();
    // So does a call with a time limit that is not a positive number.
    const timeoutMs = programTimeLimit(spawnOptions);
    const scripted = take(spawnScript, (entry) => sameWords(entry.commandLine, commandLine));
    if (scripted === undefined) {
      throw new Error(
        `fakeWorld has no scripted answer for spawn ${JSON.stringify(commandLine)}; add one to its spawn list`,
      );
    }
    if (scripted.missing === true) {
      const [program = ""] = commandLine;
      throw notInstalled(program);
    }
    if (scripted.limit === "time") {
      throw timeLimitReached(commandLine, timeoutMs);
    }
    const answer = scripted.answer ?? {};
    return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
  }

  function answerFetch(input: string | URL | Request, init?: RequestInit): Response {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    calls.push({ kind: "fetch", method: request.method, url: request.url });
    request.signal.throwIfAborted();
    const scripted = take(fetchScript, (entry) => fetchMatches(entry, request));
    if (scripted === undefined) {
      throw new Error(
        `fakeWorld has no scripted answer for fetch ${request.method} ${request.url}; add one to its fetch list`,
      );
    }
    const answer = scripted.answer ?? {};
    return new Response(answer.body ?? null, {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  }

  // Promise.try turns a throw into a rejection, as the real spawn and fetch fail.
  function fakeSpawn(
    commandLine: readonly string[],
    spawnOptions?: SpawnOptions,
  ): Promise<Spawned> {
    return Promise.try(answerSpawn, commandLine, spawnOptions);
  }

  function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    return Promise.try(answerFetch, input, init);
  }

  return {
    root: options.root ?? defaultRoot,
    env: options.env ?? {},
    spawn: fakeSpawn,
    fetch: Object.assign(fakeFetch, {
      preconnect() {
        // Bun's fetch type carries `preconnect`. The fake opens no socket, so it has nothing to do.
      },
    }),
    now() {
      return new Date(time);
    },
    calls,
  };
}
