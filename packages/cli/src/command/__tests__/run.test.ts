import { describe, expect, expectTypeOf, test } from "bun:test";

import { z } from "zod";

import type { ProgressUpdate } from "../command";
import { defineCommand } from "../command";
import type { Outcome } from "../outcome";
import { exitCodes, inputError, loginNeeded, outsideError, problem } from "../outcome";
import { runCommand } from "../run";
import type { World } from "../world";
import { fakeWorld } from "../world";

/** What a front-end gives runCommand: the world, a log of progress updates, and a live signal. */
function frontEnd(world: World) {
  const updates: ProgressUpdate[] = [];
  return {
    world,
    progress(update: ProgressUpdate) {
      updates.push(update);
    },
    signal: new AbortController().signal,
    updates,
  };
}

/** A sample command that reads the GitHub user through gh and greets them by name. */
const greet = defineCommand({
  path: ["sample", "greet"],
  summary: "Greet the GitHub user by the name given.",
  input: z.object({ name: z.string().describe("The name to greet.") }),
  async run(input, context) {
    const spawned = await context.spawn(["gh", "api", "user", "--jq", ".login"]);
    return { greeting: `Hello, ${input.name}`, login: spawned.stdout.trim() };
  },
});

describe("runCommand: a command that ends normally", () => {
  test("gives ok, exit 0, the command's name, its result and a duration", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user", "--jq", ".login"], answer: { stdout: "octocat\n" } },
      ],
    });
    const outcome = await runCommand(greet, { name: "Peter" }, frontEnd(world));
    expect(outcome).toEqual({
      ok: true,
      command: "sample greet",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: { greeting: "Hello, Peter", login: "octocat" },
    });
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["gh", "api", "user", "--jq", ".login"] },
    ]);
    expectTypeOf(outcome).toEqualTypeOf<Outcome<{ greeting: string; login: string }>>();
  });

  test("the duration is the run's time in whole milliseconds", async () => {
    const wait = defineCommand({
      path: ["sample", "wait"],
      summary: "Wait 25 milliseconds.",
      input: z.object({}),
      async run() {
        await Bun.sleep(25);
        return "waited";
      },
    });
    const outcome = await runCommand(wait, {}, frontEnd(fakeWorld()));
    expect(Number.isInteger(outcome.durationMs)).toBe(true);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(20);
  });
});

describe("the failure kinds", () => {
  test("each kind has the exit code the spec gives it", () => {
    expect(exitCodes).toEqual({
      problem: 1,
      input: 2,
      outside: 3,
      login: 4,
      cancelled: 130,
      bug: 70,
    });
  });
});

describe("runCommand: a command that throws a failure helper", () => {
  test("problem gives kind problem, exit 1, its message and its issues", async () => {
    const clean = defineCommand({
      path: ["sample", "clean"],
      summary: "Fail when the working tree has changes.",
      input: z.object({}),
      async run(_input, context) {
        const spawned = await context.spawn(["git", "status", "--short"]);
        if (spawned.stdout !== "") {
          throw problem("1 file has changes", [{ field: "src/a.ts", message: "modified" }]);
        }
        return "clean";
      },
    });
    const world = fakeWorld({
      spawn: [{ commandLine: ["git", "status", "--short"], answer: { stdout: " M src/a.ts\n" } }],
    });
    const outcome = await runCommand(clean, {}, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample clean",
      exitCode: 1,
      durationMs: expect.any(Number),
      error: {
        kind: "problem",
        message: "1 file has changes",
        issues: [{ field: "src/a.ts", message: "modified" }],
      },
    });
  });

  test("inputError gives kind input and exit 2", async () => {
    const view = defineCommand({
      path: ["sample", "view"],
      summary: "Show a GitHub repo.",
      input: z.object({ repo: z.string().describe("The repo, as owner/name.") }),
      async run(input, context) {
        const spawned = await context.spawn(["gh", "repo", "view", input.repo]);
        if (spawned.code !== 0) {
          throw inputError(`no repo named ${input.repo}`, [
            { field: "repo", message: "GitHub has no repo with this name" },
          ]);
        }
        return spawned.stdout;
      },
    });
    const world = fakeWorld({
      spawn: [{ commandLine: ["gh", "repo", "view", "acmelabs-15/nope"], answer: { code: 1 } }],
    });
    const outcome = await runCommand(view, { repo: "acmelabs-15/nope" }, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample view",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message: "no repo named acmelabs-15/nope",
        issues: [{ field: "repo", message: "GitHub has no repo with this name" }],
      },
    });
  });

  test("outsideError gives kind outside, exit 3, and no issues when none are given", async () => {
    const user = defineCommand({
      path: ["sample", "user"],
      summary: "Read the GitHub user.",
      input: z.object({}),
      async run(_input, context) {
        const spawned = await context.spawn(["gh", "api", "user"]);
        if (spawned.code !== 0) {
          throw outsideError(`gh api user failed: ${spawned.stderr.trim()}`);
        }
        return spawned.stdout;
      },
    });
    const world = fakeWorld({
      spawn: [{ commandLine: ["gh", "api", "user"], answer: { code: 1, stderr: "HTTP 502\n" } }],
    });
    const outcome = await runCommand(user, {}, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample user",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: { kind: "outside", message: "gh api user failed: HTTP 502", issues: [] },
    });
  });

  test("loginNeeded gives kind login, exit 4, and a message that names the service", async () => {
    const status = defineCommand({
      path: ["sample", "status"],
      summary: "Check the gh login.",
      input: z.object({}),
      async run(_input, context) {
        const spawned = await context.spawn(["gh", "auth", "status"]);
        if (spawned.code !== 0) {
          throw loginNeeded("gh");
        }
        return "logged in";
      },
    });
    const world = fakeWorld({
      spawn: [{ commandLine: ["gh", "auth", "status"], answer: { code: 1 } }],
    });
    const outcome = await runCommand(status, {}, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample status",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message: "gh needs a login; log in to gh, then run the command again",
        issues: [],
      },
    });
  });
});

describe("runCommand: a command that throws anything else", () => {
  test("gives kind bug, exit 70, and the error's text with a request to report it", async () => {
    const world = fakeWorld();
    const outcome = await runCommand(greet, { name: "Peter" }, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample greet",
      exitCode: 70,
      durationMs: expect.any(Number),
      error: {
        kind: "bug",
        message:
          'acmelabs hit a bug: fakeWorld has no scripted answer for spawn ["gh","api","user","--jq",".login"]; add one to its spawn list. Please report it at https://github.com/acmelabs-15/cli/issues',
        issues: [],
      },
    });
  });

  test("a thrown value that is not an Error keeps its text too", async () => {
    const user = defineCommand({
      path: ["sample", "user"],
      summary: "Read the GitHub user.",
      input: z.object({}),
      async run(_input, context) {
        const spawned = await context.spawn(["gh", "api", "user"]);
        // Some libraries throw a string, not an Error.
        throw spawned.stderr;
      },
    });
    const world = fakeWorld({
      spawn: [{ commandLine: ["gh", "api", "user"], answer: { stderr: "socket hang up" } }],
    });
    const outcome = await runCommand(user, {}, frontEnd(world));
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 70,
      error: {
        kind: "bug",
        message:
          "acmelabs hit a bug: socket hang up. Please report it at https://github.com/acmelabs-15/cli/issues",
      },
    });
  });
});

describe("runCommand: the input check", () => {
  /** A sample command whose input has a required name and a list of tags, with a default. */
  const publish = defineCommand({
    path: ["sample", "publish"],
    summary: "Publish a package with its tags.",
    input: z.object({
      name: z.string({ error: "the name is missing" }).describe("The package name."),
      tags: z
        .array(z.string({ error: "a tag is text" }))
        .default(["latest"])
        .describe("The dist-tags to set."),
    }),
    async run(input, context) {
      await context.spawn(["npm", "publish", "--tag", input.tags.join(",")]);
      return input;
    },
  });

  test("bad input gives kind input, exit 2, one issue per zod issue with its path", async () => {
    const outcome = await runCommand(publish, { tags: ["latest", 7] }, frontEnd(fakeWorld()));
    expect(outcome).toEqual({
      ok: false,
      command: "sample publish",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message: "the input is not valid",
        issues: [
          { field: "name", message: "the name is missing" },
          { field: "tags[1]", message: "a tag is text" },
        ],
      },
    });
  });

  test("with bad input, the command does not run", async () => {
    const world = fakeWorld();
    await runCommand(publish, { tags: [7] }, frontEnd(world));
    expect(world.calls).toEqual([]);
  });

  test("the command gets the checked input, with zod's defaults filled in", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["npm", "publish", "--tag", "latest"] }] });
    const outcome = await runCommand(publish, { name: "@acmelabs/cli" }, frontEnd(world));
    expect(outcome).toMatchObject({
      ok: true,
      result: { name: "@acmelabs/cli", tags: ["latest"] },
    });
  });
});

describe("runCommand: the context a command runs in", () => {
  test("root, env, now and spawn come from the world; the signal from the front-end", async () => {
    const probe = defineCommand({
      path: ["sample", "probe"],
      summary: "Report what the context holds.",
      input: z.object({}),
      async run(_input, context) {
        const spawned = await context.spawn(["git", "rev-parse", "HEAD"], { cwd: context.root });
        return {
          root: context.root,
          token: context.env.GH_TOKEN,
          now: context.now().toISOString(),
          head: spawned.stdout,
          signal: context.signal,
        };
      },
    });
    const world = fakeWorld({
      root: "/work/repo",
      env: { GH_TOKEN: "token" },
      now: new Date("2026-10-20T12:00:00.000Z"),
      spawn: [{ commandLine: ["git", "rev-parse", "HEAD"], answer: { stdout: "cd3db7d" } }],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(probe, {}, caller);
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        root: "/work/repo",
        token: "token",
        now: "2026-10-20T12:00:00.000Z",
        head: "cd3db7d",
      },
    });
    expect(outcome.ok && outcome.result.signal).toBe(caller.signal);
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["git", "rev-parse", "HEAD"], cwd: "/work/repo" },
    ]);
  });

  test("progress forwards each update to the front-end", async () => {
    const tag = defineCommand({
      path: ["sample", "tag"],
      summary: "Move the latest tag.",
      input: z.object({}),
      async run(_input, context) {
        context.progress({
          kind: "step",
          step: "move-tag",
          title: "Move the latest tag",
          status: "started",
        });
        await context.spawn(["git", "tag", "--force", "latest"]);
        context.progress({
          kind: "step",
          step: "move-tag",
          title: "Move the latest tag",
          status: "done",
        });
        context.progress({ kind: "message", level: "warning", text: "the tag is not pushed" });
        return "moved";
      },
    });
    const caller = frontEnd(
      fakeWorld({ spawn: [{ commandLine: ["git", "tag", "--force", "latest"] }] }),
    );
    await runCommand(tag, {}, caller);
    expect(caller.updates).toEqual([
      { kind: "step", step: "move-tag", title: "Move the latest tag", status: "started" },
      { kind: "step", step: "move-tag", title: "Move the latest tag", status: "done" },
      { kind: "message", level: "warning", text: "the tag is not pushed" },
    ]);
  });

  /** A sample command that asks, once its tag exists, whether to add it to the marketplace. */
  const release = defineCommand({
    path: ["sample", "release"],
    summary: "Release a plugin, and add it to the marketplace when asked.",
    input: z.object({
      marketplace: z.boolean().optional().describe("Add the plugin to the marketplace."),
    }),
    async run(_input, context) {
      await context.spawn(["git", "tag", "v1.0.0"]);
      return { marketplace: await context.ask("marketplace") };
    },
  });

  test("ask returns the value given up front, false too", async () => {
    const yes = frontEnd(fakeWorld({ spawn: [{ commandLine: ["git", "tag", "v1.0.0"] }] }));
    expect(await runCommand(release, { marketplace: true }, yes)).toMatchObject({
      ok: true,
      result: { marketplace: true },
    });
    const no = frontEnd(fakeWorld({ spawn: [{ commandLine: ["git", "tag", "v1.0.0"] }] }));
    expect(await runCommand(release, { marketplace: false }, no)).toMatchObject({
      ok: true,
      result: { marketplace: false },
    });
  });

  test("ask with no value gives kind input, exit 2, and an issue naming the field", async () => {
    const caller = frontEnd(fakeWorld({ spawn: [{ commandLine: ["git", "tag", "v1.0.0"] }] }));
    const outcome = await runCommand(release, {}, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample release",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message: "the input marketplace has no value",
        issues: [
          {
            field: "marketplace",
            message: "no value was given; give one when you run the command",
          },
        ],
      },
    });
  });
});
