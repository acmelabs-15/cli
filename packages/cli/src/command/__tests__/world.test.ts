import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CommandError } from "../outcome";
import type { FetchInit, World } from "../world";
import { fakeWorld, limits, realWorld } from "../world";

let work: string;

/** A local HTTP server, with one route for each kind of answer the request tests need. */
let server: ReturnType<typeof Bun.serve>;

/**
 * A local TCP server that answers in raw HTTP, for the answers Bun.serve does not send: a body
 * that announces 1 GB and sends 10 bytes, and a 304 with a Content-Length.
 */
let raw: Bun.TCPSocketListener;

/** Resolved with the request when the server gets one at /hold; a test sets a new one first. */
let held = Promise.withResolvers<Request>();

/** Resolved when the server's /slow-body stream is cancelled; a test sets a new one first. */
let slowBodyCancelled = Promise.withResolvers<string>();

/** How many requests the server got at /count. */
let counted = 0;

/** The URL of a path on the local server. */
function at(route: string): string {
  return new URL(route, server.url).href;
}

/** The URL of a path on the raw server. */
function atRaw(route: string): string {
  return `http://localhost:${raw.port}${route}`;
}

/** Reads a stream to its end, and keeps nothing. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<void> {
  for await (const _chunk of stream) {
    // Each chunk is read and dropped.
  }
}

beforeAll(async () => {
  // The real path, because macOS reaches the temp folder through a symlink.
  work = await realpath(await mkdtemp(path.join(tmpdir(), "acmelabs-world-")));
  server = Bun.serve({
    port: 0,
    routes: {
      async "/late"() {
        await Bun.sleep(1000);
        return new Response("late answer");
      },
      async "/hold"(request) {
        held.resolve(request);
        await Bun.sleep(3000);
        return new Response("late answer");
      },
      // Headers at once, then one byte every 100 ms, and no end.
      "/slow-body": () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              await Bun.sleep(100);
              controller.enqueue(new TextEncoder().encode("x"));
            },
            cancel() {
              slowBodyCancelled.resolve("cancelled");
            },
          }),
        ),
      // A chunked body of 64 KB chunks, as fast as the reader takes them, and no end.
      "/endless": () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(64 * 1024).fill(120));
            },
          }),
        ),
      // 2 MB of x, compressed to about 2 KB: its Content-Length is the compressed size.
      "/gzip": () =>
        new Response(Bun.gzipSync(Buffer.alloc(2 * 1024 * 1024, "x")), {
          headers: { "Content-Encoding": "gzip" },
        }),
      "/moved": () => Response.redirect("/made", 302),
      // Bun.serve sends the standard reason phrase, Created.
      "/made": () => new Response("made", { status: 201, headers: { "x-acmelabs": "made" } }),
      "/count"() {
        counted += 1;
        return new Response("counted");
      },
      // A body of that many bytes of x; Bun sends its Content-Length.
      "/bytes/:count": (request) => new Response(Buffer.alloc(Number(request.params.count), "x")),
    },
    fetch: () => new Response("no such route", { status: 404 }),
  });
  raw = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data(socket, data) {
        // The request's first line names its path, such as `GET /not-modified HTTP/1.1`.
        socket.write(
          data.toString().startsWith("GET /not-modified ")
            ? "HTTP/1.1 304 Not Modified\r\nContent-Length: 2097152\r\n\r\n"
            : "HTTP/1.1 200 OK\r\nContent-Length: 1073741824\r\n\r\n0123456789",
        );
      },
    },
  });
});

afterAll(async () => {
  // Not awaited: on Bun 1.4.0, after a time-out on one request and a cancel on another, the server
  // never sees those clients go, and its stop never resolves. Bun's own fetch does the same.
  server.stop(true);
  raw.stop(true);
  await rm(work, { recursive: true, force: true });
});

describe("realWorld", () => {
  test("spawn runs bun --version: code 0 and Bun's version on stdout", async () => {
    const spawned = await realWorld().spawn(["bun", "--version"]);
    expect(spawned).toEqual({ code: 0, stdout: `${Bun.version}\n`, stderr: "" });
  });

  test("spawn collects a failing program's exit code and stderr", async () => {
    const spawned = await realWorld().spawn([
      "bun",
      "-e",
      "process.stdout.write('half'); console.error('it broke'); process.exit(3)",
    ]);
    expect(spawned).toEqual({ code: 3, stdout: "half", stderr: "it broke\n" });
  });

  test("spawn runs the program in the working folder given as cwd", async () => {
    const spawned = await realWorld().spawn(["bun", "-e", "process.stdout.write(process.cwd())"], {
      cwd: work,
    });
    expect(spawned).toEqual({ code: 0, stdout: work, stderr: "" });
  });

  test("spawn gives the program the stdin text", async () => {
    const spawned = await realWorld().spawn(
      ["bun", "-e", "process.stdout.write(await Bun.stdin.text())"],
      { stdin: "line one\nline two\n" },
    );
    expect(spawned).toEqual({ code: 0, stdout: "line one\nline two\n", stderr: "" });
  });

  test("spawn stops the program soon after its signal aborts, and rejects with the reason", async () => {
    const pidFile = path.join(work, "sleeper.pid");
    const controller = new AbortController();
    const started = performance.now();
    const spawned = realWorld().spawn(
      [
        "bun",
        "-e",
        `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); await Bun.sleep(10000)`,
      ],
      { signal: controller.signal },
    );
    // The program writes its process id first, so the abort comes while it runs.
    while (!(await Bun.file(pidFile).exists())) {
      await Bun.sleep(10);
    }
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(spawned).rejects.toBe(reason);
    expect(performance.now() - started).toBeLessThan(2000);
    // Signal 0 checks that a process exists: the program no longer runs.
    const pid = Number(await Bun.file(pidFile).text());
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("spawn with a signal already aborted rejects with the reason, and starts nothing", async () => {
    const marker = path.join(work, "started");
    const reason = new Error("cancelled before the start");
    const spawned = realWorld().spawn(
      ["bun", "-e", `await Bun.write(${JSON.stringify(marker)}, "started")`],
      { signal: AbortSignal.abort(reason) },
    );
    await expect(spawned).rejects.toBe(reason);
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("spawn of a program that is not on PATH rejects with an outside failure that names it", async () => {
    const spawned = realWorld().spawn(["acmelabs-no-such-program-4f2b9c", "--version"]);
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "acmelabs-no-such-program-4f2b9c is not installed or not on PATH",
      issues: [],
    });
  });

  test("any other spawn error stays as Bun gives it: a working folder that does not exist", async () => {
    // Bun gives this error code ENOENT and the program's name too, so only its syscall tells it
    // apart from a program that is not on PATH.
    const spawned = realWorld().spawn(["bun", "--version"], {
      cwd: path.join(work, "no-such-folder"),
    });
    await expect(spawned).rejects.toMatchObject({ code: "ENOENT", syscall: "posix_spawn" });
    await expect(spawned).rejects.not.toBeInstanceOf(CommandError);
  });

  test("the program gets the whole environment, plus the call's env, whose value wins", async () => {
    /** A program that prints four variables of its environment as a JSON list. */
    const printEnv = [
      "const { ACMELABS_WORLD_TEST_PARENT, ACMELABS_WORLD_TEST_BOTH, ACMELABS_WORLD_TEST_ADDED, HOME } = process.env;",
      "process.stdout.write(JSON.stringify([ACMELABS_WORLD_TEST_PARENT, ACMELABS_WORLD_TEST_BOTH, ACMELABS_WORLD_TEST_ADDED, HOME]));",
    ].join(" ");
    // Variables set here, at run time, so the test knows each value the program must see.
    process.env.ACMELABS_WORLD_TEST_PARENT = "from the environment";
    process.env.ACMELABS_WORLD_TEST_BOTH = "from the environment";
    try {
      const spawned = await realWorld().spawn(["bun", "-e", printEnv], {
        env: { ACMELABS_WORLD_TEST_BOTH: "from the call", ACMELABS_WORLD_TEST_ADDED: "added" },
      });
      expect(JSON.parse(spawned.stdout)).toEqual([
        "from the environment",
        "from the call",
        "added",
        process.env.HOME,
      ]);
    } finally {
      Reflect.deleteProperty(process.env, "ACMELABS_WORLD_TEST_PARENT");
      Reflect.deleteProperty(process.env, "ACMELABS_WORLD_TEST_BOTH");
    }
  });

  test("root is the working folder, and env the process environment", () => {
    const world = realWorld();
    expect(world.root).toBe(process.cwd());
    expect(world.env).toBe(process.env);
  });

  test("fetch is a plain function that takes a request and its limits", () => {
    // A type test: tsc checks it in `bun run typecheck`. Bun's own fetch type carries more, such
    // as `preconnect`, which the World does not copy.
    expectTypeOf<World["fetch"]>().toEqualTypeOf<
      (input: string | URL | Request, init?: FetchInit) => Promise<Response>
    >();
  });

  test("now is the current time", () => {
    const before = Date.now();
    const now = realWorld().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("realWorld: a program's time limit", () => {
  /** A program that sleeps 2 seconds, then prints. */
  const sleeper = "await Bun.sleep(2000); process.stdout.write('awake')";

  test("a program gets 5 minutes unless the call sets its own time limit", () => {
    expect(limits.programMs).toBe(300_000);
  });

  test("a program past its time limit is stopped, with an outside failure that names it and the limit", async () => {
    const started = performance.now();
    const spawned = realWorld().spawn(["bun", "-e", sleeper], { timeoutMs: 200 });
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "bun -e ... ran longer than 200 milliseconds and was stopped",
      issues: [],
    });
    // The program would print after 2 seconds; the call ends before that, so the program stopped.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("with the time limit raised, the same program finishes with its output", async () => {
    const spawned = await realWorld().spawn(["bun", "-e", sleeper], { timeoutMs: 10_000 });
    expect(spawned).toEqual({ code: 0, stdout: "awake", stderr: "" });
  });

  test("a limit longer than a timer can hold still lets the program finish", async () => {
    // setTimeout fires at once for a delay past 2^31 - 1 ms; the World must not.
    const spawned = await realWorld().spawn(
      ["bun", "-e", "await Bun.sleep(100); process.stdout.write('awake')"],
      { timeoutMs: Number.POSITIVE_INFINITY },
    );
    expect(spawned).toEqual({ code: 0, stdout: "awake", stderr: "" });
  });

  test("a time limit that is not a positive number is a bug in the caller, and starts nothing", async () => {
    const marker = path.join(work, "started-with-a-bad-limit");
    const commandLine = ["bun", "-e", `await Bun.write(${JSON.stringify(marker)}, "started")`];
    for (const timeoutMs of [Number.NaN, 0, -1]) {
      const spawned = realWorld().spawn(commandLine, { timeoutMs });
      await expect(spawned).rejects.toThrow(
        `a program's time limit is a positive number of milliseconds, not ${timeoutMs}`,
      );
      await expect(spawned).rejects.not.toBeInstanceOf(CommandError);
    }
    const fake = fakeWorld({ spawn: [{ commandLine }] });
    await expect(fake.spawn(commandLine, { timeoutMs: 0 })).rejects.toThrow(
      "a program's time limit is a positive number of milliseconds, not 0",
    );
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("a program's own child stops with it at the time limit, in under 2 seconds", async () => {
    const started = performance.now();
    // The child (sleep 2; echo late) and sleep 10 hold the stdout pipe: only a stop of the whole
    // process group lets the call end before them.
    const spawned = realWorld().spawn(["bash", "-c", "(sleep 2; echo late) & sleep 10"], {
      timeoutMs: 200,
    });
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "bash -c ... ran longer than 200 milliseconds and was stopped",
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a program's own child stops with it on a cancel, in under 2 seconds", async () => {
    const marker = path.join(work, "child-started");
    const controller = new AbortController();
    const started = performance.now();
    // On macOS, a child that bash starts at the moment of the SIGTERM misses it, because the group
    // signal skips a process still in fork. The SIGKILL after the grace stops it: a short grace
    // keeps that well under 2 seconds.
    const spawned = realWorld({ graceMs: 200 }).spawn(
      ["bash", "-c", `(sleep 2; echo late) & echo started > "${marker}"; sleep 10`],
      { signal: controller.signal },
    );
    // The program writes the marker once its child runs, so the cancel comes while both run.
    while (!(await Bun.file(marker).exists())) {
      await Bun.sleep(10);
    }
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(spawned).rejects.toBe(reason);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a program that ignores SIGTERM is killed after the grace", async () => {
    const pidFile = path.join(work, "stubborn.pid");
    const controller = new AbortController();
    const spawned = realWorld({ graceMs: 200 }).spawn(
      ["bash", "-c", `trap '' TERM; echo $$ > "${pidFile}"; sleep 10`],
      { signal: controller.signal },
    );
    // The program writes its process id after its trap is set, so SIGTERM comes to a deaf program.
    while (!(await Bun.file(pidFile).exists())) {
      await Bun.sleep(10);
    }
    const reason = new Error("the user pressed Ctrl+C");
    const aborted = performance.now();
    controller.abort(reason);
    await expect(spawned).rejects.toBe(reason);
    const waited = performance.now() - aborted;
    // SIGTERM did not stop it, so it ran until SIGKILL at the grace: 200 ms, not at once, not 10 s.
    expect(waited).toBeGreaterThanOrEqual(150);
    expect(waited).toBeLessThan(2000);
    // Signal 0 checks that a process exists: the program no longer runs.
    const pid = Number(await Bun.file(pidFile).text());
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("after a cancel, acmelabs does not wait for the grace once the group's programs have ended", async () => {
    const worldFile = path.join(import.meta.dir, "..", "world.ts");
    /**
     * A script, run as its own process as acmelabs is. Five times, it starts 10 programs through
     * realWorld, each with 4 children, and cancels them all at once. Then it prints the time its
     * last call ended, and lets its event loop end. Each program starts its children, then writes
     * its marker, then only waits. Many ended children at once wait longer to be reaped, so the end
     * of a call often finds a group that holds only ended programs. A call that does not end with
     * the cancel's reason writes to stderr.
     */
    const script = [
      `import { realWorld } from ${JSON.stringify(worldFile)};`,
      `const work = ${JSON.stringify(work)};`,
      "const world = realWorld();",
      "const program = 'sleep 10 & '.repeat(4) + 'echo started > \"$0\"; wait';",
      "for (let round = 0; round < 5; round += 1) {",
      "  const controller = new AbortController();",
      "  const reason = new Error('the user pressed Ctrl+C');",
      "  const markers = Array.from({ length: 10 }, (_, run) =>",
      "    work + '/cancelled-' + round + '-' + run,",
      "  );",
      "  const calls = markers.map((marker) =>",
      "    world.spawn(['bash', '-c', program, marker], { signal: controller.signal }),",
      "  );",
      "  for (const marker of markers) {",
      "    while (!(await Bun.file(marker).exists())) await Bun.sleep(5);",
      "  }",
      "  controller.abort(reason);",
      "  for (const end of await Promise.allSettled(calls)) {",
      "    if (end.status !== 'rejected' || end.reason !== reason) {",
      "      console.error('a call did not end with the cancel');",
      "    }",
      "  }",
      "}",
      "process.stdout.write(String(Date.now()));",
    ].join("\n");
    // A time limit below the test's own, so a script that hangs stops with its group.
    const spawned = await realWorld().spawn(["bun", "-e", script], { timeoutMs: 8000 });
    expect(spawned.stderr).toBe("");
    // A SIGKILL timer kept for an ended group would keep the script alive for the grace, 5 s.
    const lingered = Date.now() - Number(spawned.stdout);
    expect(lingered).toBeLessThan(2000);
  }, 10_000);
});

describe("realWorld: a program's output limit", () => {
  /** 1 MB, 1024 × 1024 bytes: the limit most of these tests set. */
  const oneMB = 1024 * 1024;
  /** A program that prints 10 MB and 1 byte on stdout, then ends. */
  const tenMBAndOne = "process.stdout.write(Buffer.alloc(10 * 1024 * 1024 + 1, 'x'))";

  test("a program gets 10 MB on each stream unless the call sets its own output limit", () => {
    expect(limits.outputBytes).toBe(10_485_760);
  });

  test("a program that prints past its output limit on stdout is stopped, with an outside failure that names the stream and the limit", async () => {
    const started = performance.now();
    // yes prints until something stops it, so the call ends only through the stop.
    const spawned = realWorld().spawn(["yes"], { maxOutputBytes: oneMB });
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "yes printed more than 1 MB on stdout and was stopped",
      issues: [],
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a program that prints past its output limit on stderr is stopped, with an outside failure that names the stream and the limit", async () => {
    const started = performance.now();
    const spawned = realWorld().spawn(["bash", "-c", "yes >&2"], { maxOutputBytes: oneMB });
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "bash -c ... printed more than 1 MB on stderr and was stopped",
      issues: [],
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a program's own child stops with it at the output limit, in under 2 seconds", async () => {
    const started = performance.now();
    // The child (sleep 3; echo late) holds the pipes: only a stop of the whole process group lets
    // the call end before it.
    const spawned = realWorld().spawn(["bash", "-c", "(sleep 3; echo late) & yes"], {
      maxOutputBytes: oneMB,
    });
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "bash -c ... printed more than 1 MB on stdout and was stopped",
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a program that ends right after it prints past its output limit gets the same failure", async () => {
    const spawned = realWorld().spawn(["bash", "-c", "printf 'past the limit'"], {
      maxOutputBytes: 4,
    });
    // The World reads nothing until the program has ended. Its process group then holds only an
    // ended program that is not yet reaped, and macOS answers a signal to that group with EPERM.
    Bun.sleepSync(200);
    // A plain await, as a command waits: expect(...).rejects waits in its own way, and then Bun
    // mostly reaps the program before the World reads its output.
    const failure: unknown = await spawned.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CommandError);
    expect(failure).toMatchObject({
      kind: "outside",
      message: "bash -c ... printed more than 4 bytes on stdout and was stopped",
    });
  });

  test("a program that prints past 10 MB is stopped when the call sets no output limit", async () => {
    const spawned = realWorld().spawn(["bun", "-e", tenMBAndOne]);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "bun -e ... printed more than 10 MB on stdout and was stopped",
    });
  });

  test("with the output limit raised, the same program keeps all its output", async () => {
    const spawned = await realWorld().spawn(["bun", "-e", tenMBAndOne], {
      maxOutputBytes: 11 * oneMB,
    });
    expect(spawned.code).toBe(0);
    expect(spawned.stdout.length).toBe(10_485_761);
    expect(spawned.stdout).toMatch(/^x+$/u);
    expect(spawned.stderr).toBe("");
  });

  test("output of exactly the limit is kept, on each stream on its own", async () => {
    // 1 MB on stdout and 1 MB on stderr: together past the limit, each one at it.
    const spawned = await realWorld().spawn(
      [
        "bun",
        "-e",
        "process.stdout.write(Buffer.alloc(1024 * 1024, 'o')); process.stderr.write(Buffer.alloc(1024 * 1024, 'e'))",
      ],
      { maxOutputBytes: oneMB },
    );
    expect(spawned.code).toBe(0);
    expect(spawned.stdout.length).toBe(1_048_576);
    expect(spawned.stdout).toMatch(/^o+$/u);
    expect(spawned.stderr.length).toBe(1_048_576);
    expect(spawned.stderr).toMatch(/^e+$/u);
  });

  test("a character split across two reads of the pipe stays whole", async () => {
    // The euro sign is 3 bytes; the program sends its first byte, waits, then sends the rest.
    const spawned = await realWorld().spawn([
      "bun",
      "-e",
      "process.stdout.write(Buffer.from([0xe2])); await Bun.sleep(50); process.stdout.write(Buffer.from([0x82, 0xac, 0x0a]))",
    ]);
    expect(spawned).toEqual({ code: 0, stdout: "€\n", stderr: "" });
  });

  test("an output limit that is not a positive number is a bug in the caller, and starts nothing", async () => {
    const marker = path.join(work, "started-with-a-bad-output-limit");
    const commandLine = ["bun", "-e", `await Bun.write(${JSON.stringify(marker)}, "started")`];
    for (const maxOutputBytes of [Number.NaN, 0, -1]) {
      const spawned = realWorld().spawn(commandLine, { maxOutputBytes });
      await expect(spawned).rejects.toThrow(
        `a program's output limit is a positive number of bytes, not ${maxOutputBytes}`,
      );
      await expect(spawned).rejects.not.toBeInstanceOf(CommandError);
    }
    const fake = fakeWorld({ spawn: [{ commandLine }] });
    await expect(fake.spawn(commandLine, { maxOutputBytes: 0 })).rejects.toThrow(
      "a program's output limit is a positive number of bytes, not 0",
    );
    expect(await Bun.file(marker).exists()).toBe(false);
  });
});

describe("realWorld: a request's time limit", () => {
  test("a request gets 1 minute, to the end of its body, unless the call sets its own time limit", () => {
    expect(limits.requestMs).toBe(60_000);
  });

  test("a request whose answer does not come within its time limit fails, with an outside failure that names it and the limit", async () => {
    // The server answers after 1 second; the call fails before that, so the request stopped.
    const fetched = realWorld().fetch(at("/late"), { timeoutMs: 300 });
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/late")} got no whole answer within 300 milliseconds and was stopped`,
      issues: [],
    });
  });

  test("a request whose body does not end within its time limit fails at the read of the body, with the same failure", async () => {
    const started = performance.now();
    // The headers come at once, so fetch gives the response; the body never ends.
    const response = await realWorld().fetch(at("/slow-body"), { timeoutMs: 300 });
    expect(response.status).toBe(200);
    const read = response.text();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/slow-body")} got no whole answer within 300 milliseconds and was stopped`,
      issues: [],
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("with the time limit raised, the same request gets its answer", async () => {
    const response = await realWorld().fetch(at("/late"), { timeoutMs: 10_000 });
    expect(await response.text()).toBe("late answer");
  });

  test("a limit longer than a timer can hold still lets the request finish", async () => {
    // AbortSignal.timeout throws for Infinity; the World must not.
    const response = await realWorld().fetch(at("/bytes/5"), {
      timeoutMs: Number.POSITIVE_INFINITY,
    });
    expect(await response.text()).toBe("xxxxx");
  });

  test("a cancel while the request waits for its answer rejects with the cancel's reason, not a time-out", async () => {
    const controller = new AbortController();
    held = Promise.withResolvers();
    const started = performance.now();
    // No time limit of its own: 1 minute, so only the cancel can end the call in this test.
    const fetched = realWorld().fetch(at("/hold"), { signal: controller.signal });
    // The server has the request, so the cancel comes while the request waits.
    await held.promise;
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(fetched).rejects.toBe(reason);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a cancel while the body is read rejects the read with the cancel's reason, not a time-out", async () => {
    const controller = new AbortController();
    const response = await realWorld().fetch(at("/slow-body"), { signal: controller.signal });
    const read = response.text();
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(read).rejects.toBe(reason);
  });

  test("a cancel of the body by its reader ends the read in progress, and stops the fetched body", async () => {
    slowBodyCancelled = Promise.withResolvers();
    const response = await realWorld().fetch(at("/slow-body"));
    const reader = (response.body ?? new ReadableStream<Uint8Array>()).getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    // The next byte comes in 100 ms; the cancel comes while the read waits for it.
    const pending = reader.read();
    await reader.cancel(new Error("the command needs no more of the body"));
    expect(await pending).toEqual({ done: true, value: undefined });
    // The server's stream is cancelled once the fetched body is.
    expect(await slowBodyCancelled.promise).toBe("cancelled");
  });

  test("a cancel wins over the time limit when both come before the read of the body", async () => {
    const controller = new AbortController();
    const response = await realWorld().fetch(at("/slow-body"), {
      signal: controller.signal,
      timeoutMs: 200,
    });
    // The time-out comes first, and then the cancel; the body is read after both.
    await Bun.sleep(400);
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(response.text()).rejects.toBe(reason);
  });

  test("a Request keeps its own method in the failure, and its own signal", async () => {
    const fetched = realWorld().fetch(new Request(at("/late"), { method: "POST" }), {
      timeoutMs: 300,
    });
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `POST ${at("/late")} got no whole answer within 300 milliseconds and was stopped`,
    });
    const controller = new AbortController();
    held = Promise.withResolvers();
    const cancelled = realWorld().fetch(new Request(at("/hold"), { signal: controller.signal }));
    await held.promise;
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
  });

  test("a request's limit that is not a positive number is a bug in the caller, and sends nothing", async () => {
    counted = 0;
    for (const timeoutMs of [Number.NaN, 0, -1]) {
      const fetched = realWorld().fetch(at("/count"), { timeoutMs });
      await expect(fetched).rejects.toThrow(
        `a request's time limit is a positive number of milliseconds, not ${timeoutMs}`,
      );
      await expect(fetched).rejects.not.toBeInstanceOf(CommandError);
    }
    for (const maxBodyBytes of [Number.NaN, 0, -1]) {
      const fetched = realWorld().fetch(at("/count"), { maxBodyBytes });
      await expect(fetched).rejects.toThrow(
        `a request's body limit is a positive number of bytes, not ${maxBodyBytes}`,
      );
      await expect(fetched).rejects.not.toBeInstanceOf(CommandError);
    }
    const fake = fakeWorld({ fetch: [{ url: at("/count") }, { url: at("/count") }] });
    await expect(fake.fetch(at("/count"), { timeoutMs: 0 })).rejects.toThrow(
      "a request's time limit is a positive number of milliseconds, not 0",
    );
    await expect(fake.fetch(at("/count"), { maxBodyBytes: 0 })).rejects.toThrow(
      "a request's body limit is a positive number of bytes, not 0",
    );
    expect(counted).toBe(0);
  });
});

describe("realWorld: a request's body limit", () => {
  /** 1 MB, 1024 × 1024 bytes: the limit most of these tests set. */
  const oneMB = 1024 * 1024;

  test("a response body gets 10 MB unless the call sets its own body limit", () => {
    expect(limits.outputBytes).toBe(10_485_760);
  });

  test("a body whose Content-Length is above the body limit fails at its first read, and is never read", async () => {
    // The raw server announces 1 GB and sends 10 bytes. A read of the body would wait for the
    // rest until the time limit, and fail with the time limit's message, not this one.
    const response = await realWorld().fetch(atRaw("/announced"), {
      timeoutMs: 1500,
      maxBodyBytes: oneMB,
    });
    expect(response.status).toBe(200);
    const read = response.text();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${atRaw("/announced")} got a body of more than 1 MB and was stopped`,
      issues: [],
    });
  });

  test("an endless body stops at the body limit, with an outside failure that names the request and the limit", async () => {
    const started = performance.now();
    const response = await realWorld().fetch(at("/endless"), { maxBodyBytes: oneMB });
    const read = response.text();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/endless")} got a body of more than 1 MB and was stopped`,
      issues: [],
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a read of an over-limit body by json(), by bytes() or by its stream rejects with the same failure", async () => {
    const message = `GET ${at("/endless")} got a body of more than 1 MB and was stopped`;
    const world = realWorld();
    const asJson = await world.fetch(at("/endless"), { maxBodyBytes: oneMB });
    await expect(asJson.json()).rejects.toMatchObject({ kind: "outside", message });
    const asBytes = await world.fetch(at("/endless"), { maxBodyBytes: oneMB });
    await expect(asBytes.bytes()).rejects.toMatchObject({ kind: "outside", message });
    const asStream = await world.fetch(at("/endless"), { maxBodyBytes: oneMB });
    await expect(readAll(asStream.body ?? new ReadableStream())).rejects.toMatchObject({
      kind: "outside",
      message,
    });
  });

  test("a compressed body is counted as it reads, after decompression, not by its Content-Length", async () => {
    // About 2 KB on the wire, 2 MB once Bun decompresses it.
    const response = await realWorld().fetch(at("/gzip"), { maxBodyBytes: oneMB });
    expect(Number(response.headers.get("content-length"))).toBeLessThan(oneMB);
    await expect(response.text()).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/gzip")} got a body of more than 1 MB and was stopped`,
    });
  });

  test("a body under the body limit, and a body of exactly the limit, reads whole", async () => {
    const world = realWorld();
    const small = await world.fetch(at("/bytes/5"), { maxBodyBytes: oneMB });
    expect(await small.text()).toBe("xxxxx");
    const exact = await world.fetch(at(`/bytes/${oneMB}`), { maxBodyBytes: oneMB });
    const text = await exact.text();
    expect(text.length).toBe(1_048_576);
    expect(text).toMatch(/^x+$/u);
  });

  test("a body past 10 MB fails when the call sets no body limit", async () => {
    const response = await realWorld().fetch(at(`/bytes/${10 * oneMB + 1}`));
    await expect(response.text()).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at(`/bytes/${10 * oneMB + 1}`)} got a body of more than 10 MB and was stopped`,
    });
  });

  test("with the body limit raised, the same body reads whole", async () => {
    const response = await realWorld().fetch(at(`/bytes/${10 * oneMB + 1}`), {
      maxBodyBytes: 11 * oneMB,
    });
    const body = await response.bytes();
    expect(body.byteLength).toBe(10_485_761);
  });

  test("an answer that HTTP gives no body, to HEAD or a 304, passes the body limit whatever its Content-Length", async () => {
    const world = realWorld();
    // A HEAD answer's Content-Length tells the size of the body a GET would get.
    const head = await world.fetch(at(`/bytes/${2 * oneMB}`), {
      method: "HEAD",
      maxBodyBytes: oneMB,
    });
    expect(head.headers.get("content-length")).toBe("2097152");
    expect(await head.text()).toBe("");
    const notModified = await world.fetch(atRaw("/not-modified"), { maxBodyBytes: oneMB });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("content-length")).toBe("2097152");
    expect(await notModified.text()).toBe("");
  });

  test("the response keeps its status, headers and URL, after a redirect too", async () => {
    const response = await realWorld().fetch(at("/moved"));
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-acmelabs")).toBe("made");
    expect(response.url).toBe(at("/made"));
    expect(response.redirected).toBe(true);
    expect(await response.text()).toBe("made");
  });
});

describe("fakeWorld", () => {
  test("root, env and now come from the options", () => {
    const world = fakeWorld({
      root: work,
      env: { GH_TOKEN: "token" },
      now: new Date("2026-10-20T12:00:00.000Z"),
    });
    expect(world.root).toBe(work);
    expect(world.env).toEqual({ GH_TOKEN: "token" });
    expect(world.now()).toEqual(new Date("2026-10-20T12:00:00.000Z"));
  });

  test("with no options: a root that does not exist, an empty env and a fixed time", () => {
    const world = fakeWorld();
    expect(world.root).toBe("/fake-world/repo");
    expect(world.env).toEqual({});
    expect(world.now()).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  test("an unscripted spawn call fails with an error that names the call", async () => {
    const world = fakeWorld();
    await expect(world.spawn(["gh", "auth", "status"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","auth","status"]; add one to its spawn list',
    );
  });

  test("spawn returns the scripted answer; an unset field is code 0 or no output", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "auth", "status"], answer: { code: 1, stderr: "not logged in\n" } },
        { commandLine: ["git", "status", "--short"] },
      ],
    });
    expect(await world.spawn(["git", "status", "--short"])).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
    expect(await world.spawn(["gh", "auth", "status"])).toEqual({
      code: 1,
      stdout: "",
      stderr: "not logged in\n",
    });
  });

  test("spawn matches a scripted command line word for word", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["gh", "auth", "status"] }] });
    await expect(world.spawn(["gh", "auth"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","auth"]',
    );
    await expect(world.spawn(["gh", "auth", "status", "--active"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","auth","status","--active"]',
    );
    expect(await world.spawn(["gh", "auth", "status"])).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  test("a scripted missing program rejects as realWorld's spawn does, and is logged", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ["claude", "plugin", "validate", "."], missing: true }],
    });
    const spawned = world.spawn(["claude", "plugin", "validate", "."]);
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "claude is not installed or not on PATH",
      issues: [],
    });
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["claude", "plugin", "validate", "."] },
    ]);
  });

  test("a scripted time limit rejects with the same outside failure as realWorld's, and is logged", async () => {
    const commandLine = ["bun", "-e", "await Bun.sleep(2000); process.stdout.write('awake')"];
    const world = fakeWorld({ spawn: [{ commandLine, limit: "time" }] });
    const spawned = world.spawn(commandLine, { timeoutMs: 200 });
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "bun -e ... ran longer than 200 milliseconds and was stopped",
      issues: [],
    });
    expect(world.calls).toEqual([{ kind: "spawn", commandLine, timeoutMs: 200 }]);
  });

  test("a scripted time limit names the call's limit in words, or 5 minutes when it sets none", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user"], limit: "time" },
        { commandLine: ["bun", "install"], limit: "time" },
        { commandLine: ["git", "push"], limit: "time" },
        { commandLine: ["gh"], limit: "time" },
        { commandLine: ["git", "ls-remote"], limit: "time" },
      ],
    });
    await expect(world.spawn(["gh", "api", "user"])).rejects.toThrow(
      "gh api ... ran longer than 5 minutes and was stopped",
    );
    await expect(world.spawn(["bun", "install"], { timeoutMs: 60_000 })).rejects.toThrow(
      "bun install ran longer than 1 minute and was stopped",
    );
    await expect(world.spawn(["git", "push"], { timeoutMs: 90_000 })).rejects.toThrow(
      "git push ran longer than 90 seconds and was stopped",
    );
    await expect(world.spawn(["gh"], { timeoutMs: 1000 })).rejects.toThrow(
      "gh ran longer than 1 second and was stopped",
    );
    await expect(world.spawn(["git", "ls-remote"], { timeoutMs: 1500 })).rejects.toThrow(
      "git ls-remote ran longer than 1500 milliseconds and was stopped",
    );
  });

  test("a scripted output limit rejects with the same outside failure as realWorld's, and is logged", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["yes"], limit: "output" }] });
    const spawned = world.spawn(["yes"], { maxOutputBytes: 1024 * 1024 });
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "yes printed more than 1 MB on stdout and was stopped",
      issues: [],
    });
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["yes"], maxOutputBytes: 1_048_576 },
    ]);
  });

  test("a scripted output limit names the call's limit in words, or 10 MB when it sets none", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user"], limit: "output" },
        { commandLine: ["git", "log"], limit: "output" },
        { commandLine: ["bun", "install"], limit: "output" },
        { commandLine: ["git", "ls-remote"], limit: "output" },
        { commandLine: ["gh"], limit: "output" },
      ],
    });
    await expect(world.spawn(["gh", "api", "user"])).rejects.toThrow(
      "gh api ... printed more than 10 MB on stdout and was stopped",
    );
    await expect(world.spawn(["git", "log"], { maxOutputBytes: 64 * 1024 })).rejects.toThrow(
      "git log printed more than 64 KB on stdout and was stopped",
    );
    await expect(world.spawn(["bun", "install"], { maxOutputBytes: 1_572_864 })).rejects.toThrow(
      "bun install printed more than 1536 KB on stdout and was stopped",
    );
    await expect(world.spawn(["git", "ls-remote"], { maxOutputBytes: 1500 })).rejects.toThrow(
      "git ls-remote printed more than 1500 bytes on stdout and was stopped",
    );
    await expect(world.spawn(["gh"], { maxOutputBytes: 1 })).rejects.toThrow(
      "gh printed more than 1 byte on stdout and was stopped",
    );
  });

  test("the log keeps a spawn call's env and limits, and leaves out its signal", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["git", "push"] }] });
    await world.spawn(["git", "push"], {
      cwd: work,
      env: { GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 60_000,
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(world.calls).toEqual([
      {
        kind: "spawn",
        commandLine: ["git", "push"],
        cwd: work,
        env: { GIT_TERMINAL_PROMPT: "0" },
        timeoutMs: 60_000,
        maxOutputBytes: 1024,
      },
    ]);
  });

  test("an unscripted fetch call fails with an error that names the method and URL", async () => {
    const world = fakeWorld();
    await expect(
      world.fetch("https://registry.npmjs.org/@acmelabs/cli", { method: "PUT" }),
    ).rejects.toThrow(
      "fakeWorld has no scripted answer for fetch PUT https://registry.npmjs.org/@acmelabs/cli; add one to its fetch list",
    );
  });

  test("fetch returns the scripted response; an unset field is status 200 or no body", async () => {
    const world = fakeWorld({
      fetch: [
        {
          url: "https://registry.npmjs.org/@acmelabs/cli",
          answer: {
            status: 404,
            body: '{"error":"Not found"}',
            headers: { "content-type": "application/json" },
          },
        },
        { method: "PUT", url: "https://registry.npmjs.org/@acmelabs/cli" },
      ],
    });
    const missing = await world.fetch("https://registry.npmjs.org/@acmelabs/cli");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("application/json");
    expect(await missing.json()).toEqual({ error: "Not found" });
    const published = await world.fetch(new URL("https://registry.npmjs.org/@acmelabs/cli"), {
      method: "PUT",
    });
    expect(published.status).toBe(200);
    expect(await published.text()).toBe("");
  });

  test("fetch matches the method, GET by default, and the URL in normal form", async () => {
    const world = fakeWorld({
      fetch: [{ url: "https://api.github.com" }, { method: "put", url: "https://api.github.com" }],
    });
    await expect(world.fetch("https://api.github.com/", { method: "POST" })).rejects.toThrow(
      "fakeWorld has no scripted answer for fetch POST https://api.github.com/",
    );
    const read = await world.fetch("https://api.github.com/");
    expect(read.status).toBe(200);
    const written = await world.fetch("https://api.github.com/", { method: "PUT" });
    expect(written.status).toBe(200);
  });

  test("logs every spawn and fetch call in order, the unscripted ones too", async () => {
    const ruleset = '{"name":"Protect main"}';
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "auth", "status"] },
        { commandLine: ["gh", "api", "repos/acmelabs-15/cli/rulesets", "--input", "-"] },
      ],
      fetch: [{ url: "https://registry.npmjs.org/@acmelabs/cli" }],
    });
    await world.spawn(["gh", "auth", "status"], { cwd: work });
    await world.fetch("https://registry.npmjs.org/@acmelabs/cli");
    await world.spawn(["gh", "api", "repos/acmelabs-15/cli/rulesets", "--input", "-"], {
      stdin: ruleset,
    });
    await expect(world.spawn(["git", "push"])).rejects.toThrow("no scripted answer");
    await expect(world.fetch("https://example.com/", { method: "DELETE" })).rejects.toThrow(
      "no scripted answer",
    );
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["gh", "auth", "status"], cwd: work },
      { kind: "fetch", method: "GET", url: "https://registry.npmjs.org/@acmelabs/cli" },
      {
        kind: "spawn",
        commandLine: ["gh", "api", "repos/acmelabs-15/cli/rulesets", "--input", "-"],
        stdin: ruleset,
      },
      { kind: "spawn", commandLine: ["git", "push"] },
      { kind: "fetch", method: "DELETE", url: "https://example.com/" },
    ]);
  });

  test("a spawn or fetch whose signal is aborted rejects with the reason, and is logged", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ["git", "push"] }],
      fetch: [{ url: "https://api.github.com/" }],
    });
    const reason = new Error("the user pressed Ctrl+C");
    const signal = AbortSignal.abort(reason);
    await expect(world.spawn(["git", "push"], { cwd: work, signal })).rejects.toBe(reason);
    await expect(world.fetch("https://api.github.com/", { signal })).rejects.toBe(reason);
    await expect(world.fetch(new Request("https://api.github.com/", { signal }))).rejects.toBe(
      reason,
    );
    // A cancelled call uses up no scripted answer, so a call that is not cancelled still gets it.
    expect(await world.spawn(["git", "push"])).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["git", "push"], cwd: work },
      { kind: "fetch", method: "GET", url: "https://api.github.com/" },
      { kind: "fetch", method: "GET", url: "https://api.github.com/" },
      { kind: "spawn", commandLine: ["git", "push"] },
    ]);
  });

  test("each scripted spawn answers one call, in list order, so a retry can succeed", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user"], answer: { code: 1, stderr: "HTTP 502\n" } },
        { commandLine: ["gh", "api", "user"], answer: { stdout: '{"login":"octocat"}' } },
      ],
    });
    expect(await world.spawn(["gh", "api", "user"])).toEqual({
      code: 1,
      stdout: "",
      stderr: "HTTP 502\n",
    });
    expect(await world.spawn(["gh", "api", "user"])).toEqual({
      code: 0,
      stdout: '{"login":"octocat"}',
      stderr: "",
    });
    await expect(world.spawn(["gh", "api", "user"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","api","user"]',
    );
  });

  test("each scripted fetch answers one call, in list order, so a retry can succeed", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({
      fetch: [
        { url, answer: { status: 503 } },
        { url, answer: { status: 200 } },
      ],
    });
    const first = await world.fetch(url);
    expect(first.status).toBe(503);
    const retry = await world.fetch(url);
    expect(retry.status).toBe(200);
    await expect(world.fetch(url)).rejects.toThrow(
      `fakeWorld has no scripted answer for fetch GET ${url}`,
    );
  });

  test("a scripted request time limit rejects the fetch with the same outside failure as realWorld's, and is logged", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({ fetch: [{ url, limit: "time" }] });
    const fetched = world.fetch(url, { timeoutMs: 300 });
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${url} got no whole answer within 300 milliseconds and was stopped`,
      issues: [],
    });
    expect(world.calls).toEqual([{ kind: "fetch", method: "GET", url }]);
  });

  test("a scripted request time limit names the method, the URL in normal form, and the call's limit, or 1 minute when it sets none", async () => {
    const world = fakeWorld({
      fetch: [
        { url: "https://api.github.com", limit: "time" },
        { method: "PUT", url: "https://registry.npmjs.org/@acmelabs%2fcli", limit: "time" },
      ],
    });
    await expect(world.fetch("https://api.github.com")).rejects.toThrow(
      "GET https://api.github.com/ got no whole answer within 1 minute and was stopped",
    );
    const request = new Request("https://registry.npmjs.org/@acmelabs%2fcli", { method: "PUT" });
    await expect(world.fetch(request, { timeoutMs: 90_000 })).rejects.toThrow(
      "PUT https://registry.npmjs.org/@acmelabs%2fcli got no whole answer within 90 seconds and was stopped",
    );
  });

  test("a scripted body limit gives the response, and a read of its body rejects with the same outside failure as realWorld's", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({
      fetch: [
        {
          url,
          answer: { status: 200, headers: { "content-type": "application/json" } },
          limit: "output",
        },
      ],
    });
    const response = await world.fetch(url, { maxBodyBytes: 1024 * 1024 });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const read = response.json();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${url} got a body of more than 1 MB and was stopped`,
      issues: [],
    });
    expect(world.calls).toEqual([{ kind: "fetch", method: "GET", url }]);
  });

  test("a scripted body limit names the call's limit in words, or 10 MB when it sets none", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({
      fetch: [
        { url, limit: "output" },
        { url, limit: "output" },
      ],
    });
    const unset = await world.fetch(url);
    await expect(unset.text()).rejects.toThrow(
      `GET ${url} got a body of more than 10 MB and was stopped`,
    );
    const set = await world.fetch(url, { maxBodyBytes: 64 * 1024 });
    await expect(set.text()).rejects.toThrow(
      `GET ${url} got a body of more than 64 KB and was stopped`,
    );
  });
});
