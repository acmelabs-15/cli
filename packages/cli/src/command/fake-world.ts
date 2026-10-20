import { sameWords } from "./words";
import type { FetchInit, SpawnOptions, Spawned, World } from "./world";
import { failingBody, fetchOptions, methodAndUrl } from "./world-fetch";
import {
  bodyLimitReached,
  outputLimitReached,
  programLimits,
  requestLimits,
  requestTimeLimitReached,
  timeLimitReached,
} from "./world-limits";
import { notInstalled } from "./world-spawn";

/**
 * A scripted answer to a spawn call: the command line it matches, word for word, and its end. A
 * `missing` program is not installed, and a program with a `limit` reached it: the call rejects as
 * realWorld's does, and `answer` is unused. `limits`, the defaults, is in `world-limits.ts`.
 */
export type ScriptedSpawn = {
  commandLine: readonly string[];
  answer?: Partial<Spawned>;
  missing?: boolean;
  /**
   * "time": the program ran past the call's time limit, or past `limits.programMs`. "output": it
   * printed past the call's output limit, or past `limits.outputBytes`, on stdout.
   */
  limit?: "time" | "output";
};

/**
 * A scripted answer to a fetch call: the method (GET when unset) and the URL it matches, and the
 * response's status, body and headers. A request with a `limit` reached it, as realWorld's does.
 */
export type ScriptedFetch = {
  method?: string;
  url: string;
  answer?: { status?: number; body?: string; headers?: Record<string, string> };
  /**
   * "time": the request got no whole answer within the call's time limit, or `limits.requestMs`;
   * the call rejects. "output": its body passed the call's body limit, or `limits.outputBytes`;
   * the call gives the response with the answer's status and headers, and a read of its body
   * rejects.
   */
  limit?: "time" | "output";
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
 * the signal's reason, and an answer with a `limit` fails, each as the real one does. `calls` logs
 * every call, in order.
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
    // So does a call with a limit that is not a positive number.
    const { timeoutMs, maxOutputBytes } = programLimits(spawnOptions);
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
    if (scripted.limit === "output") {
      throw outputLimitReached(commandLine, "stdout", maxOutputBytes);
    }
    const answer = scripted.answer ?? {};
    return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
  }

  function answerFetch(input: string | URL | Request, init: FetchInit = {}): Response {
    const requestInit = fetchOptions(init);
    const request =
      input instanceof Request
        ? new Request(input, requestInit)
        : new Request(String(input), requestInit);
    calls.push({ kind: "fetch", method: request.method, url: request.url });
    request.signal.throwIfAborted();
    // So does a call with a limit that is not a positive number.
    const { timeoutMs, maxBodyBytes } = requestLimits(init);
    const scripted = take(fetchScript, (entry) => fetchMatches(entry, request));
    if (scripted === undefined) {
      throw new Error(
        `fakeWorld has no scripted answer for fetch ${request.method} ${request.url}; add one to its fetch list`,
      );
    }
    if (scripted.limit === "time") {
      throw requestTimeLimitReached(methodAndUrl(request), timeoutMs);
    }
    const answer = scripted.answer ?? {};
    const body =
      scripted.limit === "output"
        ? failingBody(bodyLimitReached(methodAndUrl(request), maxBodyBytes))
        : (answer.body ?? null);
    return new Response(body, { status: answer.status ?? 200, headers: answer.headers });
  }

  // Promise.try turns a throw into a rejection, as the real spawn and fetch fail.
  function fakeSpawn(
    commandLine: readonly string[],
    spawnOptions?: SpawnOptions,
  ): Promise<Spawned> {
    return Promise.try(answerSpawn, commandLine, spawnOptions);
  }

  function fakeFetch(input: string | URL | Request, init?: FetchInit): Promise<Response> {
    return Promise.try(answerFetch, input, init);
  }

  return {
    root: options.root ?? defaultRoot,
    env: options.env ?? {},
    spawn: fakeSpawn,
    fetch: fakeFetch,
    now() {
      return new Date(time);
    },
    calls,
  };
}
