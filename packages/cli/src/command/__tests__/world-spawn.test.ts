import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fakeWorld } from "../fake-world";
import { CommandError } from "../outcome";
import { realWorld } from "../world";
import { limits } from "../world-limits";

let work: string;

beforeAll(async () => {
  // The real path, because macOS reaches the temp folder through a symlink.
  work = await realpath(await mkdtemp(path.join(tmpdir(), "acmelabs-world-")));
});

afterAll(async () => {
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

  test("a program gets the World's own env when realWorld is given one, without a variable that the call's env gives as undefined", async () => {
    /** A program that prints three variables of its environment as a JSON object. */
    const printEnv = [
      "const { ACMELABS_WORLD_TEST_KEPT, ACMELABS_WORLD_TEST_REMOVED, HOME } = process.env;",
      "process.stdout.write(JSON.stringify({ kept: ACMELABS_WORLD_TEST_KEPT, removed: ACMELABS_WORLD_TEST_REMOVED ?? null, home: HOME }));",
    ].join(" ");
    // The World's own env, so the test changes no variable of the test process.
    const world = realWorld({
      env: {
        ...Bun.env,
        ACMELABS_WORLD_TEST_KEPT: "from the World",
        ACMELABS_WORLD_TEST_REMOVED: "from the World",
      },
    });
    const spawned = await world.spawn(["bun", "-e", printEnv], {
      env: { ACMELABS_WORLD_TEST_REMOVED: undefined },
    });
    expect(JSON.parse(spawned.stdout)).toEqual({
      kept: "from the World",
      removed: null,
      home: Bun.env.HOME,
    });
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
