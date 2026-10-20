import type { CommandError } from "./outcome";
import { outsideError } from "./outcome";
import type { FetchInit, SpawnOptions } from "./world";

/** The limits that every outside program and request gets unless the call changes them. */
export const limits = {
  /** A program's time limit: 5 minutes. */
  programMs: 5 * 60 * 1000,
  /** A request's time limit, to the end of its body: 1 minute. */
  requestMs: 60 * 1000,
  /** The most bytes kept from stdout, from stderr, or from a response body: 10 MB. */
  outputBytes: 10 * 1024 * 1024,
} as const;

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
export function durationOf(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return countOf(ms / 60_000, "minute");
  }
  if (ms >= 1000 && ms % 1000 === 0) {
    return countOf(ms / 1000, "second");
  }
  return countOf(ms, "millisecond");
}

/** The bytes in a KB, and in a MB: 1024, and 1024 KB. */
const kb = 1024;
const mb = 1024 * kb;

/** A size in words, in its largest whole unit: 10 MB, 64 KB, 1500 bytes. */
function sizeOf(bytes: number): string {
  if (bytes >= mb && bytes % mb === 0) {
    return `${bytes / mb} MB`;
  }
  if (bytes >= kb && bytes % kb === 0) {
    return `${bytes / kb} KB`;
  }
  return countOf(bytes, "byte");
}

/**
 * A limit that a spawn or fetch call gives, such as its time limit in milliseconds. `name` says
 * whose limit it is, such as "a program's time limit". A limit that is not a positive number is a
 * bug in the caller, not an outside failure, so it throws a plain Error.
 */
function positiveLimit(limit: number, name: string, unit: string): number {
  if (Number.isNaN(limit) || limit <= 0) {
    throw new Error(`${name} is a positive number of ${unit}, not ${limit}`);
  }
  return limit;
}

/** A spawn call's limits: its own, or the ones in `limits`. */
export function programLimits(options: SpawnOptions): {
  timeoutMs: number;
  maxOutputBytes: number;
} {
  return {
    timeoutMs: positiveLimit(
      options.timeoutMs ?? limits.programMs,
      "a program's time limit",
      "milliseconds",
    ),
    maxOutputBytes: positiveLimit(
      options.maxOutputBytes ?? limits.outputBytes,
      "a program's output limit",
      "bytes",
    ),
  };
}

/** A fetch call's limits: its own, or the ones in `limits`. */
export function requestLimits(init: FetchInit): { timeoutMs: number; maxBodyBytes: number } {
  return {
    timeoutMs: positiveLimit(
      init.timeoutMs ?? limits.requestMs,
      "a request's time limit",
      "milliseconds",
    ),
    maxBodyBytes: positiveLimit(
      init.maxBodyBytes ?? limits.outputBytes,
      "a request's body limit",
      "bytes",
    ),
  };
}

/**
 * The outside failure for a program stopped at its time limit, kind `outside`, exit 3: it names the
 * program and the limit. realWorld and fakeWorld both give it, so a test of a limit sees the real
 * failure.
 */
export function timeLimitReached(commandLine: readonly string[], timeoutMs: number): CommandError {
  return outsideError(
    `${shortCommandLine(commandLine)} ran longer than ${durationOf(timeoutMs)} and was stopped`,
  );
}

/** A program's output stream: stdout or stderr. */
export type OutputStream = "stdout" | "stderr";

/**
 * The outside failure for a program stopped past its output limit, kind `outside`, exit 3: it
 * names the program, the stream and the limit. realWorld and fakeWorld both give it.
 */
export function outputLimitReached(
  commandLine: readonly string[],
  stream: OutputStream,
  maxOutputBytes: number,
): CommandError {
  return outsideError(
    `${shortCommandLine(commandLine)} printed more than ${sizeOf(maxOutputBytes)} on ${stream} and was stopped`,
  );
}

/**
 * The outside failure for a request stopped at its time limit, kind `outside`, exit 3: it names
 * the request and the limit. realWorld and fakeWorld both give it.
 */
export function requestTimeLimitReached(request: string, timeoutMs: number): CommandError {
  return outsideError(
    `${request} got no whole answer within ${durationOf(timeoutMs)} and was stopped`,
  );
}

/**
 * The outside failure for a response body stopped past its body limit, kind `outside`, exit 3: it
 * names the request and the limit. realWorld and fakeWorld both give it.
 */
export function bodyLimitReached(request: string, maxBodyBytes: number): CommandError {
  return outsideError(`${request} got a body of more than ${sizeOf(maxBodyBytes)} and was stopped`);
}

/** The longest delay a timer holds: setTimeout fires at once for a longer one. */
export const longestTimerMs = 2 ** 31 - 1;

/**
 * How long a wait lasts, in milliseconds: the time a sleep call gives, up to `longestTimerMs`,
 * about 24 days. 0 is a wait that ends at once, such as a retry whose time has come. A time that is
 * not a finite number of 0 or more is a bug in the caller, so it throws a plain Error. realWorld
 * and fakeWorld both use it, so a fake clock moves as long as the real wait lasts.
 */
export function waitMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`a wait is a finite number of milliseconds, 0 or more, not ${ms}`);
  }
  return Math.min(ms, longestTimerMs);
}

/**
 * The byte counter of one stream, for a program's output and for a response body: it counts each
 * chunk's bytes, and tells whether the count has passed `maxBytes`. Exactly `maxBytes` is kept.
 */
export function byteCounter(maxBytes: number): (chunk: Uint8Array) => boolean {
  let bytes = 0;
  return (chunk) => {
    bytes += chunk.byteLength;
    return bytes > maxBytes;
  };
}
