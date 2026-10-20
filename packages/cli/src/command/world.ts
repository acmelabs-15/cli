// Named `wait` here, so it is not taken for the global setTimeout, which takes no signal.
import { setTimeout as wait } from "node:timers/promises";

import { fetchWithLimits } from "./world-fetch";
import { waitMs } from "./world-limits";
import { spawnWithBun } from "./world-spawn";

/**
 * How to run a spawned program: its working folder, the text it reads on stdin, the signal that
 * stops it, the variables added to its environment, and its time and output limits. `limits`, the
 * defaults of a program's and a request's limits, is in `world-limits.ts`.
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
  /**
   * The program's output limit in bytes, a positive number, for stdout and for stderr each on its
   * own: `limits.outputBytes` when unset.
   */
  maxOutputBytes?: number;
};

/** How a spawned program ended: its exit code, and its output as text. */
export type Spawned = { code: number; stdout: string; stderr: string };

/** A request's options: fetch's own, and its limits. */
export type FetchInit = RequestInit & {
  /**
   * The request's time limit in milliseconds, to the end of its body, a positive number:
   * `limits.requestMs` when unset. A limit past about 24 days acts as about 24 days.
   */
  timeoutMs?: number;
  /** The most bytes of the response body, a positive number: `limits.outputBytes` when unset. */
  maxBodyBytes?: number;
};

/** How to wait: the signal that ends the wait early. */
export type SleepOptions = { signal?: AbortSignal };

/** The outside world a command reaches. Commands reach programs, the network and env only here. */
export type World = {
  /** The repo folder the command acts on; the working folder by default. */
  root: string;
  /** The environment variables. */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Runs a program, with no shell, and returns its exit code and output. The program gets the whole
   * environment plus the call's `env`. At its time limit, or past its output limit on stdout or on
   * stderr, the program and every program it started stop, and the call rejects with an outside
   * failure that names the program and the limit. When the signal aborts, they stop too, and the
   * call rejects with the signal's reason, as fetch does. A program that is not installed rejects
   * with an outside failure that names it.
   */
  spawn: (commandLine: readonly string[], options?: SpawnOptions) => Promise<Spawned>;
  /**
   * Sends an HTTP request, as the global fetch does, under a time limit and a body limit. A request
   * that gets no whole answer, its body included, within its time limit stops and rejects with an
   * outside failure that names the method, the URL and the limit; a read of the body rejects so
   * when the time-out comes during the body. A body past its body limit stops, and its read
   * rejects with an outside failure too: at once when its Content-Length tells it, so it is never
   * read. A request that fails in the network, such as a refused connection, a reset, or a DNS or
   * TLS failure, rejects with an outside failure that names the method, the URL and what failed,
   * and so does a read of a body that fails so. A caller's bug, such as an invalid URL or header,
   * rejects as fetch rejects it. When the signal aborts, the call or the read rejects with the
   * signal's reason.
   */
  fetch: (input: string | URL | Request, init?: FetchInit) => Promise<Response>;
  /** The current time. */
  now: () => Date;
  /**
   * Waits `ms` milliseconds, unless the signal aborts first: then the call rejects with the
   * signal's reason, as spawn and fetch do. A fake World moves its clock instead of waiting. A wait
   * past about 24 days, the longest a timer holds, ends after about 24 days. A time that is not a
   * finite number of 0 or more is a bug in the caller.
   */
  sleep: (ms: number, options?: SleepOptions) => Promise<void>;
};

/** What realWorld takes: the grace between SIGTERM and SIGKILL when it stops a program. */
export type RealWorldOptions = {
  /** 5 seconds when unset; a test of a program that ignores SIGTERM sets less. */
  graceMs?: number;
};

/** The grace between SIGTERM and SIGKILL when realWorld stops a program: 5 seconds. */
const defaultGraceMs = 5 * 1000;

/**
 * Waits with a timer from `node:timers/promises`, which takes the signal. On Bun 1.4.0 its cancel
 * rejects with its own AbortError, which holds the signal's reason only as its `cause`, so the
 * wait rejects with the reason itself. Its timer fires at once, with a warning on stderr, for a
 * delay past `longestTimerMs`; `waitMs` holds the delay to that.
 */
async function sleepWithTimer(ms: number, signal: AbortSignal | undefined): Promise<void> {
  // An aborted signal starts no wait, and the call keeps the signal's reason.
  signal?.throwIfAborted();
  const delay = waitMs(ms);
  try {
    await wait(delay, undefined, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

/**
 * The real World: the working folder, the process environment, Bun's spawn and fetch, each under
 * its limits, the clock, and a timer. It is the one place in the CLI that touches the process for
 * these.
 */
export function realWorld(options: RealWorldOptions = {}): World {
  const graceMs = options.graceMs ?? defaultGraceMs;
  return {
    root: process.cwd(),
    env: Bun.env,
    spawn(commandLine, spawnOptions = {}) {
      return spawnWithBun(commandLine, spawnOptions, graceMs);
    },
    fetch: fetchWithLimits,
    now() {
      return new Date();
    },
    sleep(ms, sleepOptions = {}) {
      return sleepWithTimer(ms, sleepOptions.signal);
    },
  };
}
