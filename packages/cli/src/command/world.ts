/**
 * How to run a spawned program: its working folder, the text it reads on stdin, and the signal that
 * stops it.
 */
export type SpawnOptions = { cwd?: string; stdin?: string; signal?: AbortSignal };

/** How a spawned program ended: its exit code, and its output as text. */
export type Spawned = { code: number; stdout: string; stderr: string };

/** The outside world a command reaches. Commands reach programs, the network and env only here. */
export type World = {
  /** The repo folder the command acts on; the working folder by default. */
  root: string;
  /** The environment variables. */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Runs a program, with no shell, and returns its exit code and output. When the signal aborts,
   * the program stops and the call rejects with the signal's reason, as fetch does.
   */
  spawn: (commandLine: readonly string[], options?: SpawnOptions) => Promise<Spawned>;
  /** Sends an HTTP request. */
  fetch: typeof globalThis.fetch;
  /** The current time. */
  now: () => Date;
};

/**
 * Runs a program with Bun, with no shell, and collects its exit code and output as text. With no
 * stdin text, the program gets no stdin, so it can never wait on the user's terminal. Bun stops the
 * program (SIGTERM) when the signal aborts.
 */
async function spawnWithBun(
  commandLine: readonly string[],
  options: SpawnOptions = {},
): Promise<Spawned> {
  const { signal } = options;
  // An aborted signal starts no program. Bun would throw its own AbortError; this keeps the reason.
  signal?.throwIfAborted();
  const child = Bun.spawn([...commandLine], {
    cwd: options.cwd,
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stderr: "pipe",
    signal,
  });
  const [stdout, stderr, code] = await Promise.all([
    child.stdout.text(),
    child.stderr.text(),
    child.exited,
  ]);
  // A program stopped by the signal has no result to give.
  signal?.throwIfAborted();
  return { code, stdout, stderr };
}

/**
 * The real World: the working folder, the process environment, Bun's spawn, the global fetch and
 * the clock. It is the one place in the CLI that touches the process for these.
 */
export function realWorld(): World {
  return {
    root: process.cwd(),
    env: Bun.env,
    spawn: spawnWithBun,
    fetch: globalThis.fetch,
    now() {
      return new Date();
    },
  };
}

/** A scripted answer to a spawn call: the command line it matches, word for word, and its end. */
export type ScriptedSpawn = { commandLine: readonly string[]; answer?: Partial<Spawned> };

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

/** Whether two command lines have the same words in the same order. */
function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((word, index) => word === right[index]);
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
    const scripted = take(spawnScript, (entry) => sameWords(entry.commandLine, commandLine));
    if (scripted === undefined) {
      throw new Error(
        `fakeWorld has no scripted answer for spawn ${JSON.stringify(commandLine)}; add one to its spawn list`,
      );
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
