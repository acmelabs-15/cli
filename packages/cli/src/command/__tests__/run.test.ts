import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { readRepoConfig } from "../../repo/config";
import type { ProgressUpdate } from "../command";
import { defineCommand } from "../command";
import type { Outcome } from "../outcome";
import { exitCodes, inputError, loginNeeded, outsideError, problem } from "../outcome";
import type { Question } from "../run";
import { flagOf, runCommand } from "../run";
import type { World } from "../world";
import { fakeWorld, realWorld } from "../world";

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

describe("a command's result is JSON", () => {
  /** A sample command's declaration, with no run. */
  const count = {
    path: ["sample", "count"],
    summary: "Count the manifests.",
    input: z.object({}),
  } as const;

  test("a result that JSON cannot hold as it is does not type-check", () => {
    // A type test: tsc checks it in `bun run typecheck`, and no command runs.
    // @ts-expect-error -- a bigint has no JSON form.
    defineCommand({ ...count, run: () => Promise.resolve(3n) });
    // @ts-expect-error -- a function has no JSON form.
    defineCommand({ ...count, run: () => Promise.resolve(() => 3) });
    // @ts-expect-error -- a command that returns nothing has no result for the result line.
    defineCommand({ ...count, async run() {} });
    // @ts-expect-error -- JSON turns a Date into a string, so a reader gets another type back.
    defineCommand({ ...count, run: (_input, context) => Promise.resolve({ at: context.now() }) });
    // @ts-expect-error -- a signal has no JSON form, inside an object too.
    defineCommand({ ...count, run: (_input, context) => Promise.resolve([context.signal]) });
  });

  test("objects with optional fields, lists, text, numbers and null type-check", () => {
    /** One manifest's version; a manifest with no version field has none. */
    type Found = { path: string; version?: string; host?: string | undefined };
    const found: readonly Found[] = [{ path: ".claude-plugin/plugin.json" }];
    defineCommand({ ...count, run: () => Promise.resolve({ checked: 3, found }) });
    defineCommand({ ...count, run: () => Promise.resolve(["claude-code", "codex"] as const) });
    defineCommand({ ...count, run: () => Promise.resolve("synced") });
    defineCommand({ ...count, run: () => Promise.resolve(null) });
  });

  test("a result that gets past the type but JSON cannot write ends as a bug, exit 70", async () => {
    /** A host and the host it falls back to. The type allows a cycle, which JSON cannot write. */
    type Fallback = { host: string; next?: Fallback };
    const cycle = defineCommand({
      ...count,
      run() {
        const codex: Fallback = { host: "codex" };
        codex.next = codex;
        return Promise.resolve(codex);
      },
    });
    const message =
      "acmelabs hit a bug: the command's result cannot be written as JSON. Please report it at https://github.com/acmelabs-15/cli/issues";
    expect(await runCommand(cycle, {}, frontEnd(fakeWorld()))).toEqual({
      ok: false,
      command: "sample count",
      exitCode: 70,
      durationMs: expect.any(Number),
      error: { kind: "bug", message, issues: [] },
    });
    // A value typed `any` gets past the type too: JSON.parse's reviver may give any value, here a
    // function, as an untyped library may.
    const untyped = defineCommand({
      ...count,
      run: () => Promise.resolve(JSON.parse("3", () => Math.max)),
    });
    expect(await runCommand(untyped, {}, frontEnd(fakeWorld()))).toMatchObject({
      exitCode: 70,
      error: { kind: "bug", message },
    });
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
  /** A sample command whose input has a required name, a list of tags and a dry-run switch. */
  const publish = defineCommand({
    path: ["sample", "publish"],
    summary: "Publish a package with its tags.",
    input: z.object({
      name: z.string({ error: "the name is missing" }).describe("The package name."),
      tags: z
        .array(z.string({ error: "a tag is text" }))
        .default(["latest"])
        .describe("The dist-tags to set."),
      dryRun: z
        .boolean({ error: "dry run is true or false" })
        .default(false)
        .describe("Show what would be published, and publish nothing."),
    }),
    async run(input, context) {
      await context.spawn(["npm", "publish", "--tag", input.tags.join(",")]);
      return input;
    },
  });

  test("bad input gives kind input, exit 2, and one issue per flag, named --field", async () => {
    const outcome = await runCommand(publish, { tags: ["latest", 7] }, frontEnd(fakeWorld()));
    expect(outcome).toEqual({
      ok: false,
      command: "sample publish",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message: "2 inputs are not valid",
        issues: [
          { field: "--name", message: "the name is missing" },
          { field: "--tags[1]", message: "a tag is text" },
        ],
      },
    });
  });

  test("a flag's name is the field in kebab case: dryRun is --dry-run", async () => {
    const outcome = await runCommand(
      publish,
      { name: "@acmelabs/cli", dryRun: "yes" },
      frontEnd(fakeWorld()),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: "1 input is not valid",
        issues: [{ field: "--dry-run", message: "dry run is true or false" }],
      },
    });
  });

  test("the message counts the inputs that are wrong, not the issues", async () => {
    const outcome = await runCommand(
      publish,
      { name: "@acmelabs/cli", tags: [7, 8] },
      frontEnd(fakeWorld()),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: "1 input is not valid",
        issues: [
          { field: "--tags[0]", message: "a tag is text" },
          { field: "--tags[1]", message: "a tag is text" },
        ],
      },
    });
  });

  test("a positional's issue is named <field>, and a nested path keeps its tail", async () => {
    const add = defineCommand({
      path: ["sample", "add"],
      summary: "Add a plugin to the marketplace with its tags.",
      input: z.object({
        name: z.string({ error: "the name is text" }).describe("The plugin's name."),
        tags: z.array(z.string({ error: "a tag is text" })).describe("The plugin's tags."),
        host: z.string({ error: "the host is text" }).describe("The host to add it for."),
      }),
      positionals: ["name", "tags"],
      run(input) {
        return Promise.resolve(input);
      },
    });
    const outcome = await runCommand(
      add,
      { name: 7, tags: ["agents", 7], host: 3 },
      frontEnd(fakeWorld()),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: "3 inputs are not valid",
        issues: [
          { field: "<name>", message: "the name is text" },
          { field: "<tags>[1]", message: "a tag is text" },
          { field: "--host", message: "the host is text" },
        ],
      },
    });
  });

  test("an issue with the whole input, not one field, has an empty field", async () => {
    const notify = defineCommand({
      path: ["sample", "notify"],
      summary: "Send a note by mail, by chat or both.",
      input: z
        .object({
          mail: z.string().optional().describe("The mail address."),
          chat: z.string().optional().describe("The chat channel."),
        })
        .refine((input) => input.mail !== undefined || input.chat !== undefined, {
          error: "give --mail, --chat or both",
        }),
      run(input) {
        return Promise.resolve(input);
      },
    });
    const outcome = await runCommand(notify, {}, frontEnd(fakeWorld()));
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: "1 input is not valid",
        issues: [{ field: "", message: "give --mail, --chat or both" }],
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

describe("runCommand: a bad repo config", () => {
  let work: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "acmelabs-run-"));
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  /** A sample command that reads the repo config of its root and names the repo kinds. */
  const kinds = defineCommand({
    path: ["sample", "kinds"],
    summary: "Name the repo kinds that acmelabs.json declares.",
    input: z.object({}),
    async run(_input, context) {
      return Object.keys(await readRepoConfig(context.root));
    },
  });

  test("gives kind input, exit 2, the file, and each issue at its field path", async () => {
    const root = path.join(work, "bad-fields");
    await Bun.write(
      path.join(root, "acmelabs.json"),
      JSON.stringify({ plugin: { hosts: ["claude-code", "vscode"] }, library: { packages: [] } }),
    );
    const outcome = await runCommand(kinds, {}, frontEnd(fakeWorld({ root })));
    expect(outcome).toEqual({
      ok: false,
      command: "sample kinds",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message: `${root}/acmelabs.json is not a valid repo config`,
        issues: [
          {
            field: "plugin.hosts[1]",
            message:
              '"vscode" is not a host; the hosts are claude-code, codex, gemini-cli, antigravity-cli',
          },
          { field: "library.packages", message: "the list is empty; name at least one package" },
        ],
      },
    });
  });

  test("an issue with the whole file is named acmelabs.json", async () => {
    const root = path.join(work, "no-config");
    await mkdir(root);
    const outcome = await runCommand(kinds, {}, frontEnd(fakeWorld({ root })));
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: `${root}/acmelabs.json is not a valid repo config`,
        issues: [
          {
            field: "acmelabs.json",
            message: 'the file does not exist; create it with "plugin", "library" or both',
          },
        ],
      },
    });
  });
});

describe("runCommand: the context a command runs in", () => {
  test("root, env, now and spawn come from the world; the signal from the front-end", async () => {
    // The signal is kept here, not in the result: a result is JSON, and a signal has no JSON form.
    let signal: AbortSignal | undefined;
    const probe = defineCommand({
      path: ["sample", "probe"],
      summary: "Report what the context holds.",
      input: z.object({}),
      async run(_input, context) {
        const spawned = await context.spawn(["git", "rev-parse", "HEAD"], { cwd: context.root });
        ({ signal } = context);
        return {
          root: context.root,
          token: context.env.GH_TOKEN,
          now: context.now().toISOString(),
          head: spawned.stdout,
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
    expect(signal).toBe(caller.signal);
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["git", "rev-parse", "HEAD"], cwd: "/work/repo" },
    ]);
  });
});

/** A world in which the release command's tag call succeeds. */
function tagged() {
  return fakeWorld({ spawn: [{ commandLine: ["git", "tag", "v1.0.0"] }] });
}

describe("runCommand: a question mid-run", () => {
  /** A sample command that asks, once its tag exists, whether to add it to the marketplace. */
  const release = defineCommand({
    path: ["sample", "release"],
    summary: "Release a plugin, and add it to the marketplace when asked.",
    input: z.object({
      marketplace: z
        .boolean({ error: "the answer is yes or no" })
        .optional()
        .describe("Add the plugin to the marketplace."),
    }),
    async run(_input, context) {
      await context.spawn(["git", "tag", "v1.0.0"]);
      return { marketplace: await context.ask("marketplace") };
    },
  });

  test("ask with no value asks the front-end's answer, and returns the answer", async () => {
    const questions: Question[] = [];
    const caller = {
      ...frontEnd(tagged()),
      answer(question: Question) {
        questions.push(question);
        return Promise.resolve(true);
      },
    };
    const outcome = await runCommand(release, {}, caller);
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: { marketplace: true } });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      field: "marketplace",
      flag: "--marketplace",
      description: "Add the plugin to the marketplace.",
    });
    // The schema lets a front-end pick the prompt: a boolean is a yes/no question.
    expect(questions[0]?.schema).toBe(release.input.shape.marketplace);
  });

  test("ask returns the value given up front, false too, and does not call answer", async () => {
    const questions: Question[] = [];
    function answer(question: Question) {
      questions.push(question);
      return Promise.resolve(true);
    }
    const yes = { ...frontEnd(tagged()), answer };
    expect(await runCommand(release, { marketplace: true }, yes)).toMatchObject({
      ok: true,
      result: { marketplace: true },
    });
    const no = { ...frontEnd(tagged()), answer };
    expect(await runCommand(release, { marketplace: false }, no)).toMatchObject({
      ok: true,
      result: { marketplace: false },
    });
    expect(questions).toEqual([]);
  });

  test("an answer the field's schema rejects gives kind input, exit 2, naming the flag", async () => {
    const caller = { ...frontEnd(tagged()), answer: () => Promise.resolve("maybe") };
    const outcome = await runCommand(release, {}, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample release",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message: "the answer to --marketplace is not valid",
        issues: [{ field: "--marketplace", message: "the answer is yes or no" }],
      },
    });
  });

  test("ask with no value and no answer names the flag, and how to give it", async () => {
    const outcome = await runCommand(release, {}, frontEnd(tagged()));
    const message = "--marketplace has no value; give it as a flag, for example --marketplace";
    expect(outcome).toEqual({
      ok: false,
      command: "sample release",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: { kind: "input", message, issues: [{ field: "--marketplace", message }] },
    });
  });

  test("for a field that is not a boolean, the example gives the flag a value", async () => {
    const create = defineCommand({
      path: ["sample", "create"],
      summary: "Create the GitHub repo, with the name asked when the folder has none.",
      input: z.object({
        repoName: z.string().optional().describe("The name of the GitHub repo."),
      }),
      async run(_input, context) {
        return { repoName: await context.ask("repoName") };
      },
    });
    const message = "--repo-name has no value; give it as a flag, for example --repo-name <value>";
    expect(await runCommand(create, {}, frontEnd(fakeWorld()))).toMatchObject({
      exitCode: 2,
      error: { kind: "input", message, issues: [{ field: "--repo-name", message }] },
    });
    // An answer with no value leaves the field with no value too.
    const empty = { ...frontEnd(fakeWorld()), answer: () => Promise.resolve() };
    expect(await runCommand(create, {}, empty)).toMatchObject({
      exitCode: 2,
      error: { kind: "input", message, issues: [{ field: "--repo-name", message }] },
    });
  });

  test("ask accepts only the optional fields of the command's input", () => {
    // A type test: tsc checks it in `bun run typecheck`, and the command never runs.
    defineCommand({
      path: ["sample", "publish"],
      summary: "Publish a package, and ask for the tag when none is given.",
      input: z.object({
        name: z.string().describe("The package name."),
        tag: z.string().optional().describe("The dist-tag to set."),
      }),
      async run(input, context) {
        expectTypeOf(context.ask<"tag">).returns.toEqualTypeOf<Promise<string>>();
        // @ts-expect-error -- name is required, so it always has a value and is never asked.
        await context.ask("name");
        // @ts-expect-error -- the input has no field named host.
        await context.ask("host");
        return input.name;
      },
    });
  });
});

describe("runCommand: progress updates", () => {
  test("each update reaches the front-end in the order the command sends it", async () => {
    const tag = defineCommand({
      path: ["sample", "tag"],
      summary: "Move the latest tag and push it.",
      input: z.object({}),
      async run(_input, context) {
        const move = { kind: "step", step: "move-tag", title: "Move the latest tag" } as const;
        const push = { kind: "step", step: "push-tag", title: "Push the latest tag" } as const;
        context.progress({ ...move, status: "started" });
        await context.spawn(["git", "tag", "--force", "latest"]);
        context.progress({ ...move, status: "done" });
        context.progress({ ...push, status: "started" });
        context.progress({ kind: "message", level: "info", text: "pushing to origin" });
        await context.spawn(["git", "push", "--force", "origin", "latest"]);
        context.progress({ ...push, status: "done", detail: "origin/latest" });
        context.progress({
          kind: "message",
          level: "warning",
          text: "the marketplace is not told",
        });
        return "moved";
      },
    });
    const caller = frontEnd(
      fakeWorld({
        spawn: [
          { commandLine: ["git", "tag", "--force", "latest"] },
          { commandLine: ["git", "push", "--force", "origin", "latest"] },
        ],
      }),
    );
    const outcome = await runCommand(tag, {}, caller);
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: "moved" });
    expect(caller.updates).toEqual([
      { kind: "step", step: "move-tag", title: "Move the latest tag", status: "started" },
      { kind: "step", step: "move-tag", title: "Move the latest tag", status: "done" },
      { kind: "step", step: "push-tag", title: "Push the latest tag", status: "started" },
      { kind: "message", level: "info", text: "pushing to origin" },
      {
        kind: "step",
        step: "push-tag",
        title: "Push the latest tag",
        status: "done",
        detail: "origin/latest",
      },
      { kind: "message", level: "warning", text: "the marketplace is not told" },
    ]);
  });

  test("a throw closes each open step as failed, in the order the steps started", async () => {
    const setUp = defineCommand({
      path: ["sample", "set-up"],
      summary: "Set up a repo: check the gh login, then push the first commit.",
      input: z.object({}),
      async run(_input, context) {
        const repo = { kind: "step", step: "set-up-repo", title: "Set up the repo" } as const;
        const login = { kind: "step", step: "check-login", title: "Check the gh login" } as const;
        const push = { kind: "step", step: "push-commit", title: "Push the first commit" } as const;
        context.progress({ ...repo, status: "started" });
        context.progress({ ...login, status: "started" });
        context.progress({ ...login, status: "done" });
        context.progress({ ...push, status: "started" });
        const spawned = await context.spawn(["git", "push", "origin", "main"]);
        if (spawned.code !== 0) {
          throw outsideError(`git push failed: ${spawned.stderr.trim()}`);
        }
        context.progress({ ...push, status: "done" });
        context.progress({ ...repo, status: "done" });
        return "set up";
      },
    });
    const caller = frontEnd(
      fakeWorld({
        spawn: [
          {
            commandLine: ["git", "push", "origin", "main"],
            answer: { code: 1, stderr: "rejected\n" },
          },
        ],
      }),
    );
    const outcome = await runCommand(setUp, {}, caller);
    expect(caller.updates).toEqual([
      { kind: "step", step: "set-up-repo", title: "Set up the repo", status: "started" },
      { kind: "step", step: "check-login", title: "Check the gh login", status: "started" },
      { kind: "step", step: "check-login", title: "Check the gh login", status: "done" },
      { kind: "step", step: "push-commit", title: "Push the first commit", status: "started" },
      { kind: "step", step: "set-up-repo", title: "Set up the repo", status: "failed" },
      { kind: "step", step: "push-commit", title: "Push the first commit", status: "failed" },
    ]);
    expect(outcome).toEqual({
      ok: false,
      command: "sample set-up",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: { kind: "outside", message: "git push failed: rejected", issues: [] },
    });
  });

  test("a normal end with steps still open is a bug that names them, and closes them", async () => {
    const sync = defineCommand({
      path: ["sample", "sync"],
      summary: "Write package.json's version into each manifest.",
      input: z.object({}),
      run(_input, context) {
        const read = { kind: "step", step: "read-version", title: "Read the version" } as const;
        const claude = {
          kind: "step",
          step: "write-claude",
          title: "Write Claude's manifest",
        } as const;
        const codex = {
          kind: "step",
          step: "write-codex",
          title: "Write Codex's manifest",
        } as const;
        context.progress({ ...read, status: "started" });
        context.progress({ ...claude, status: "started" });
        context.progress({ ...codex, status: "started" });
        context.progress({ ...claude, status: "done" });
        return Promise.resolve("synced");
      },
    });
    const caller = frontEnd(fakeWorld());
    const outcome = await runCommand(sync, {}, caller);
    expect(caller.updates).toEqual([
      { kind: "step", step: "read-version", title: "Read the version", status: "started" },
      { kind: "step", step: "write-claude", title: "Write Claude's manifest", status: "started" },
      { kind: "step", step: "write-codex", title: "Write Codex's manifest", status: "started" },
      { kind: "step", step: "write-claude", title: "Write Claude's manifest", status: "done" },
      { kind: "step", step: "read-version", title: "Read the version", status: "failed" },
      { kind: "step", step: "write-codex", title: "Write Codex's manifest", status: "failed" },
    ]);
    expect(outcome).toEqual({
      ok: false,
      command: "sample sync",
      exitCode: 70,
      durationMs: expect.any(Number),
      error: {
        kind: "bug",
        message:
          "acmelabs hit a bug: the command ended with steps read-version, write-codex still open. Please report it at https://github.com/acmelabs-15/cli/issues",
        issues: [],
      },
    });
  });

  test("a normal end with one step still open names that step", async () => {
    const lint = defineCommand({
      path: ["sample", "lint"],
      summary: "Run oxlint on the repo.",
      input: z.object({}),
      async run(_input, context) {
        context.progress({ kind: "step", step: "lint", title: "Run oxlint", status: "started" });
        const spawned = await context.spawn(["bunx", "oxlint"]);
        return spawned.code;
      },
    });
    const outcome = await runCommand(
      lint,
      {},
      frontEnd(fakeWorld({ spawn: [{ commandLine: ["bunx", "oxlint"] }] })),
    );
    expect(outcome).toMatchObject({
      exitCode: 70,
      error: {
        kind: "bug",
        message:
          "acmelabs hit a bug: the command ended with step lint still open. Please report it at https://github.com/acmelabs-15/cli/issues",
      },
    });
  });

  test("a step may end with no started update first: done at once, or skipped", async () => {
    const check = defineCommand({
      path: ["sample", "check"],
      summary: "Run each host's validator.",
      input: z.object({}),
      run(_input, context) {
        context.progress({
          kind: "step",
          step: "validate-claude",
          title: "Run Claude Code's validator",
          status: "done",
        });
        context.progress({
          kind: "step",
          step: "validate-agy",
          title: "Run Antigravity CLI's validator",
          status: "skipped",
          detail: "agy is not on PATH",
        });
        return Promise.resolve("checked");
      },
    });
    const caller = frontEnd(fakeWorld());
    const outcome = await runCommand(check, {}, caller);
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: "checked" });
    expect(caller.updates).toHaveLength(2);
  });

  test("a second started update for an open step is a bug that names the step", async () => {
    const tag = defineCommand({
      path: ["sample", "tag"],
      summary: "Push the release tag, and force it when the push fails.",
      input: z.object({}),
      async run(_input, context) {
        const push = { kind: "step", step: "push-tag", title: "Push the release tag" } as const;
        context.progress({ ...push, status: "started" });
        const pushed = await context.spawn(["git", "push", "origin", "v1.0.0"]);
        if (pushed.code !== 0) {
          // The defect: the retry starts the step again before the step ended.
          context.progress({ ...push, title: "Force the release tag", status: "started" });
          await context.spawn(["git", "push", "--force", "origin", "v1.0.0"]);
        }
        context.progress({ ...push, status: "done" });
        return "pushed";
      },
    });
    const world = fakeWorld({
      spawn: [
        { commandLine: ["git", "push", "origin", "v1.0.0"], answer: { code: 1 } },
        { commandLine: ["git", "push", "--force", "origin", "v1.0.0"] },
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(tag, {}, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample tag",
      exitCode: 70,
      durationMs: expect.any(Number),
      error: {
        kind: "bug",
        message:
          "acmelabs hit a bug: the command started step push-tag again while it was still open. Please report it at https://github.com/acmelabs-15/cli/issues",
        issues: [],
      },
    });
    // The front-end shows the step once, and the command stops at the defect.
    expect(caller.updates).toEqual([
      { kind: "step", step: "push-tag", title: "Push the release tag", status: "started" },
      { kind: "step", step: "push-tag", title: "Push the release tag", status: "failed" },
    ]);
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["git", "push", "origin", "v1.0.0"] },
    ]);
  });

  test("a command that catches that defect still ends as a bug", async () => {
    const build = { kind: "step", step: "build", title: "Build the package" } as const;
    const ignores = defineCommand({
      path: ["sample", "ignore"],
      summary: "Build the package, and ignore every error.",
      input: z.object({}),
      run(_input, context) {
        context.progress({ ...build, status: "started" });
        try {
          context.progress({ ...build, status: "started" });
        } catch {
          // This sample ignores every error, the defect too.
        }
        context.progress({ ...build, status: "done" });
        return Promise.resolve("built");
      },
    });
    const wraps = defineCommand({
      path: ["sample", "wrap"],
      summary: "Build the package, and report every error as an outside failure.",
      input: z.object({}),
      run(_input, context) {
        try {
          context.progress({ ...build, status: "started" });
          context.progress({ ...build, status: "started" });
          context.progress({ ...build, status: "done" });
          return Promise.resolve("built");
        } catch (error) {
          throw outsideError(`the build failed: ${String(error)}`);
        }
      },
    });
    const message =
      "acmelabs hit a bug: the command started step build again while it was still open. Please report it at https://github.com/acmelabs-15/cli/issues";
    expect(await runCommand(ignores, {}, frontEnd(fakeWorld()))).toMatchObject({
      exitCode: 70,
      error: { kind: "bug", message },
    });
    expect(await runCommand(wraps, {}, frontEnd(fakeWorld()))).toMatchObject({
      exitCode: 70,
      error: { kind: "bug", message },
    });
  });

  test("an update sent after a normal end does not reach the front-end: the result stays last", async () => {
    // The command's late work, and the update that work sends.
    const late = Promise.withResolvers<string>();
    const sent = Promise.withResolvers<string>();
    const push = defineCommand({
      path: ["sample", "push"],
      summary: "Push the tag, and report the push without waiting for it.",
      input: z.object({}),
      run(_input, context) {
        // The defect: work the command does not wait for.
        late.promise.then((text) => {
          context.progress({ kind: "message", level: "info", text });
          sent.resolve(text);
        });
        return Promise.resolve("pushed");
      },
    });
    const caller = frontEnd(fakeWorld());
    const outcome = await runCommand(push, {}, caller);
    late.resolve("the tag is pushed");
    expect(await sent.promise).toBe("the tag is pushed");
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: "pushed" });
    expect(caller.updates).toEqual([]);
  });

  test("a step may start again once it has ended", async () => {
    const retry = defineCommand({
      path: ["sample", "retry"],
      summary: "Fetch the npm registry, and try once more when it fails.",
      input: z.object({}),
      async run(_input, context) {
        const fetch = {
          kind: "step",
          step: "fetch-registry",
          title: "Fetch the registry",
        } as const;
        context.progress({ ...fetch, status: "started" });
        const first = await context.fetch("https://registry.npmjs.org/@acmelabs%2fcli");
        context.progress({ ...fetch, status: first.ok ? "done" : "failed" });
        context.progress({ ...fetch, status: "started" });
        const second = await context.fetch("https://registry.npmjs.org/@acmelabs%2fcli");
        context.progress({ ...fetch, status: second.ok ? "done" : "failed" });
        return second.status;
      },
    });
    const world = fakeWorld({
      fetch: [
        { url: "https://registry.npmjs.org/@acmelabs%2fcli", answer: { status: 503 } },
        { url: "https://registry.npmjs.org/@acmelabs%2fcli" },
      ],
    });
    const outcome = await runCommand(retry, {}, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: 200 });
  });
});

/** The outcome of a command the user cancelled. */
function cancelled(command: string): Outcome<never> {
  return {
    ok: false,
    command,
    exitCode: 130,
    durationMs: expect.any(Number),
    error: { kind: "cancelled", message: "cancelled by the user", issues: [] },
  };
}

describe("runCommand: cancel", () => {
  test("an abort mid-run gives kind cancelled, exit 130, and closes open steps as failed", async () => {
    const create = defineCommand({
      path: ["sample", "create"],
      summary: "Create the GitHub repo.",
      input: z.object({}),
      async run(_input, context) {
        const repo = {
          kind: "step",
          step: "create-repo",
          title: "Create the GitHub repo",
        } as const;
        context.progress({ ...repo, status: "started" });
        await context.spawn(["gh", "repo", "create", "acmelabs-15/demo", "--public"]);
        context.signal.throwIfAborted();
        context.progress({ ...repo, status: "done" });
        return "created";
      },
    });
    const controller = new AbortController();
    const updates: ProgressUpdate[] = [];
    const caller = {
      world: fakeWorld({
        spawn: [{ commandLine: ["gh", "repo", "create", "acmelabs-15/demo", "--public"] }],
      }),
      signal: controller.signal,
      progress(update: ProgressUpdate) {
        updates.push(update);
        // The user presses Ctrl+C once the step shows as running.
        controller.abort(new Error("the user pressed Ctrl+C"));
      },
    };
    const outcome = await runCommand(create, {}, caller);
    expect(outcome).toEqual(cancelled("sample create"));
    expect(updates).toEqual([
      { kind: "step", step: "create-repo", title: "Create the GitHub repo", status: "started" },
      { kind: "step", step: "create-repo", title: "Create the GitHub repo", status: "failed" },
    ]);
  });

  test("a signal aborted before the run ends as cancelled, and the command does not run", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user", "--jq", ".login"], answer: { stdout: "octocat\n" } },
      ],
    });
    const caller = { ...frontEnd(world), signal: AbortSignal.abort() };
    const outcome = await runCommand(greet, { name: "Peter" }, caller);
    expect(outcome).toEqual(cancelled("sample greet"));
    expect(world.calls).toEqual([]);
    expect(caller.updates).toEqual([]);
  });

  test("a command that ignores the signal ends as cancelled at once, and is not heard after", async () => {
    // The build's long work, and the command's end, long after its outcome.
    const work = Promise.withResolvers<string>();
    const finished = Promise.withResolvers<string>();
    const build = defineCommand({
      path: ["sample", "build"],
      summary: "Build the package, and publish it when asked.",
      input: z.object({
        publish: z.boolean().optional().describe("Publish the package after the build."),
      }),
      async run(_input, context) {
        const step = { kind: "step", step: "build", title: "Build the package" } as const;
        context.progress({ ...step, status: "started" });
        // Long work that does not watch the signal.
        const output = await work.promise;
        context.progress({ ...step, status: "done", detail: output });
        context.progress({ kind: "message", level: "info", text: "the build is done" });
        try {
          await context.ask("publish");
        } catch {
          // This sample ignores every error, the cancel too.
        }
        finished.resolve(output);
        return output;
      },
    });
    const controller = new AbortController();
    const updates: ProgressUpdate[] = [];
    const questions: Question[] = [];
    const caller = {
      world: fakeWorld(),
      signal: controller.signal,
      progress(update: ProgressUpdate) {
        updates.push(update);
        // The user presses Ctrl+C once the step shows as running.
        controller.abort();
      },
      answer(question: Question) {
        questions.push(question);
        return Promise.resolve(true);
      },
    };
    const outcome = await runCommand(build, {}, caller);
    expect(outcome).toEqual(cancelled("sample build"));
    // The command goes on after its outcome, and nothing it does reaches the front-end.
    work.resolve("dist/index.js");
    expect(await finished.promise).toBe("dist/index.js");
    expect(updates).toEqual([
      { kind: "step", step: "build", title: "Build the package", status: "started" },
      { kind: "step", step: "build", title: "Build the package", status: "failed" },
    ]);
    expect(questions).toEqual([]);
  });

  test("an answer that rejects because the user cancelled ends as cancelled, not as a bug", async () => {
    const tag = defineCommand({
      path: ["sample", "tag"],
      summary: "Move the latest tag when asked.",
      input: z.object({ latest: z.boolean().optional().describe("Move the latest tag.") }),
      async run(_input, context) {
        return { latest: await context.ask("latest") };
      },
    });
    const controller = new AbortController();
    const caller = {
      ...frontEnd(fakeWorld()),
      signal: controller.signal,
      answer() {
        // The user presses Ctrl+C at the prompt: the front-end aborts, and the prompt fails.
        controller.abort();
        return Promise.reject(new Error("the prompt was closed"));
      },
    };
    const outcome = await runCommand(tag, {}, caller);
    expect(outcome).toEqual(cancelled("sample tag"));
  });
});

/** How a call ended: the reason it rejected with, or "answered". */
function endOf(settled: PromiseSettledResult<unknown>): unknown {
  return settled.status === "rejected" ? settled.reason : "answered";
}

describe("runCommand: cancel reaches outside programs", () => {
  test("context.spawn and context.fetch take the run's signal, so a cancel stops them", async () => {
    const finished = Promise.withResolvers<unknown[]>();
    const publish = defineCommand({
      path: ["sample", "publish"],
      summary: "Publish the package, and check the registry.",
      input: z.object({}),
      async run(_input, context) {
        context.progress({ kind: "message", level: "info", text: "publishing" });
        const ends = await Promise.allSettled([
          context.spawn(["npm", "publish"]),
          context.fetch("https://registry.npmjs.org/-/ping"),
        ]);
        finished.resolve(ends.map(endOf));
        return "published";
      },
    });
    const controller = new AbortController();
    const reason = new Error("the user pressed Ctrl+C");
    const caller = {
      // Each call has a scripted answer, so only the signal can make it reject.
      world: fakeWorld({
        spawn: [{ commandLine: ["npm", "publish"] }],
        fetch: [{ url: "https://registry.npmjs.org/-/ping" }],
      }),
      signal: controller.signal,
      progress() {
        // The user presses Ctrl+C at the first update.
        controller.abort(reason);
      },
    };
    expect(await runCommand(publish, {}, caller)).toEqual(cancelled("sample publish"));
    expect(await finished.promise).toEqual([reason, reason]);
  });

  test("a signal the command passes itself wins over the run's signal", async () => {
    const finished = Promise.withResolvers<unknown[]>();
    const timeout = new Error("the command's own time limit");
    const check = defineCommand({
      path: ["sample", "check"],
      summary: "Check the gh login and the GitHub API, each with its own signal.",
      input: z.object({}),
      async run(_input, context) {
        // While the run is live, the command's aborted signal rejects the calls.
        const timedOut = AbortSignal.abort(timeout);
        const before = await Promise.allSettled([
          context.spawn(["gh", "auth", "status"], { signal: timedOut }),
          context.fetch("https://api.github.com/", { signal: timedOut }),
        ]);
        context.progress({ kind: "message", level: "info", text: "checked" });
        // After the cancel, the command's live signal lets the calls through.
        const live = new AbortController().signal;
        const after = await Promise.allSettled([
          context.spawn(["gh", "auth", "status"], { signal: live }),
          context.fetch("https://api.github.com/", { signal: live }),
        ]);
        finished.resolve([...before, ...after].map(endOf));
        return "checked";
      },
    });
    const controller = new AbortController();
    const caller = {
      world: fakeWorld({
        spawn: [{ commandLine: ["gh", "auth", "status"] }],
        fetch: [{ url: "https://api.github.com/" }],
      }),
      signal: controller.signal,
      progress() {
        controller.abort();
      },
    };
    expect(await runCommand(check, {}, caller)).toEqual(cancelled("sample check"));
    expect(await finished.promise).toEqual([timeout, timeout, "answered", "answered"]);
  });

  test("a Request keeps its own signal, and takes the run's signal too", async () => {
    const finished = Promise.withResolvers<unknown[]>();
    const timeout = new Error("the command's own time limit");
    const reason = new Error("the user pressed Ctrl+C");
    const read = defineCommand({
      path: ["sample", "read"],
      summary: "Read the GitHub API with a Request.",
      input: z.object({}),
      async run(_input, context) {
        const timedOut = AbortSignal.abort(timeout);
        const own = await Promise.allSettled([
          context.fetch(new Request("https://api.github.com/", { signal: timedOut })),
        ]);
        context.progress({ kind: "message", level: "info", text: "read" });
        const plain = await Promise.allSettled([
          context.fetch(new Request("https://api.github.com/")),
        ]);
        finished.resolve([...own, ...plain].map(endOf));
        return "read";
      },
    });
    const controller = new AbortController();
    const caller = {
      world: fakeWorld({ fetch: [{ url: "https://api.github.com/" }] }),
      signal: controller.signal,
      progress() {
        controller.abort(reason);
      },
    };
    expect(await runCommand(read, {}, caller)).toEqual(cancelled("sample read"));
    expect(await finished.promise).toEqual([timeout, reason]);
  });
});

/**
 * A front-end whose progress logs each update, then throws, as a write to a closed pipe does.
 * `before` runs first, such as a cancel.
 */
function brokenPipe(world: World, signal: AbortSignal, before = () => {}) {
  const updates: ProgressUpdate[] = [];
  return {
    world,
    signal,
    progress(update: ProgressUpdate): void {
      updates.push(update);
      before();
      throw new Error("EPIPE: broken pipe, write");
    },
    updates,
  };
}

/** The release tag's step, with one status. */
function pushTag(status: "started" | "done" | "failed"): ProgressUpdate {
  return { kind: "step", step: "push-tag", title: "Push the release tag", status };
}

describe("runCommand: a program that is not installed", () => {
  /** A sample command that runs the validator program it is given. */
  const validate = defineCommand({
    path: ["sample", "validate"],
    summary: "Run a host's validator on the plugin.",
    input: z.object({ validator: z.string().describe("The validator program to run.") }),
    async run(input, context) {
      const spawned = await context.spawn([input.validator, "plugin", "validate", "."]);
      return spawned.code;
    },
  });

  test("a real program that is not installed ends as an outside failure, exit 3, naming it", async () => {
    const outcome = await runCommand(
      validate,
      { validator: "acmelabs-no-such-program-4f2b9c" },
      frontEnd(realWorld()),
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample validate",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message: "acmelabs-no-such-program-4f2b9c is not installed or not on PATH",
        issues: [],
      },
    });
  });

  test("a scripted missing program ends the same way", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ["claude", "plugin", "validate", "."], missing: true }],
    });
    const outcome = await runCommand(validate, { validator: "claude" }, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample validate",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: { kind: "outside", message: "claude is not installed or not on PATH", issues: [] },
    });
  });
});

describe("runCommand: a front-end whose progress throws on every update", () => {
  /** A sample command that pushes the release tag, in one step. */
  const push = defineCommand({
    path: ["sample", "push"],
    summary: "Push the release tag.",
    input: z.object({}),
    async run(_input, context) {
      const step = { kind: "step", step: "push-tag", title: "Push the release tag" } as const;
      context.progress({ ...step, status: "started" });
      const pushed = await context.spawn(["git", "push", "origin", "v1.0.0"]);
      if (pushed.code !== 0) {
        throw problem("the push was rejected");
      }
      context.progress({ ...step, status: "done" });
      return "pushed";
    },
  });

  test("a normal end still gives ok and exit 0, and each update is still sent", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["git", "push", "origin", "v1.0.0"] }] });
    const caller = brokenPipe(world, new AbortController().signal);
    expect(await runCommand(push, {}, caller)).toEqual({
      ok: true,
      command: "sample push",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: "pushed",
    });
    expect(caller.updates).toEqual([pushTag("started"), pushTag("done")]);
  });

  test("a failure still gives its own exit code, and the open step is still closed", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ["git", "push", "origin", "v1.0.0"], answer: { code: 1 } }],
    });
    const caller = brokenPipe(world, new AbortController().signal);
    expect(await runCommand(push, {}, caller)).toEqual({
      ok: false,
      command: "sample push",
      exitCode: 1,
      durationMs: expect.any(Number),
      error: { kind: "problem", message: "the push was rejected", issues: [] },
    });
    expect(caller.updates).toEqual([pushTag("started"), pushTag("failed")]);
  });

  test("a cancel still gives exit 130, and the open step is still closed", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["git", "push", "origin", "v1.0.0"] }] });
    const controller = new AbortController();
    // The user presses Ctrl+C once the step shows as running, and the terminal is gone too.
    const caller = brokenPipe(world, controller.signal, () => controller.abort());
    expect(await runCommand(push, {}, caller)).toEqual(cancelled("sample push"));
    expect(caller.updates).toEqual([pushTag("started"), pushTag("failed")]);
  });
});

describe("runCommand: secrets removed from every text that leaves it", () => {
  test("a bug message keeps no token from a URL's query, and keeps the other parameters", async () => {
    const read = defineCommand({
      path: ["sample", "read"],
      summary: "Read the API with a token in the URL.",
      input: z.object({}),
      // A fetch error holds the full URL, its query too.
      run: () =>
        Promise.reject(new Error("fetch https://x.example/api?token=abc123def&page=2 failed")),
    });
    const outcome = await runCommand(read, {}, frontEnd(fakeWorld()));
    expect(outcome).toEqual({
      ok: false,
      command: "sample read",
      exitCode: 70,
      durationMs: expect.any(Number),
      error: {
        kind: "bug",
        message:
          "acmelabs hit a bug: fetch https://x.example/api?token=[redacted]&page=2 failed. Please report it at https://github.com/acmelabs-15/cli/issues",
        issues: [],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("abc123def");
  });

  test("a token at the end of the error's text is removed, and the message keeps its period", async () => {
    const read = defineCommand({
      path: ["sample", "read"],
      summary: "Read the API with a token in the URL.",
      input: z.object({}),
      run: () => Promise.reject(new Error("https://x?token=abc")),
    });
    expect(await runCommand(read, {}, frontEnd(fakeWorld()))).toMatchObject({
      exitCode: 70,
      error: {
        kind: "bug",
        message:
          "acmelabs hit a bug: https://x?token=[redacted]. Please report it at https://github.com/acmelabs-15/cli/issues",
      },
    });
  });

  test("an env secret is not in a progress update or the failure that the front-end gets", async () => {
    const login = defineCommand({
      path: ["sample", "login"],
      summary: "Check the GitHub token from the env.",
      input: z.object({}),
      async run(_input, context) {
        const token = context.env.GH_TOKEN ?? "";
        const check = {
          kind: "step",
          step: "check-token",
          title: `Check the token ${token}`,
        } as const;
        context.progress({
          kind: "step",
          step: "read-token",
          title: "Read the token",
          status: "done",
          detail: `found ${token}`,
        });
        context.progress({ ...check, status: "started" });
        context.progress({ kind: "message", level: "warning", text: `GH_TOKEN=${token} is old` });
        const spawned = await context.spawn(["gh", "auth", "status"]);
        throw problem(`the token ${token} is not valid: ${spawned.stderr.trim()}`, [
          { field: "GH_TOKEN", message: `${token} has expired` },
        ]);
      },
    });
    const caller = frontEnd(
      fakeWorld({
        env: { GH_TOKEN: "ghp_0123456789abcdef" },
        spawn: [
          {
            commandLine: ["gh", "auth", "status"],
            answer: { code: 1, stderr: "token ghp_0123456789abcdef is bad\n" },
          },
        ],
      }),
    );
    const outcome = await runCommand(login, {}, caller);
    expect(caller.updates).toEqual([
      {
        kind: "step",
        step: "read-token",
        title: "Read the token",
        status: "done",
        detail: "found [redacted]",
      },
      { kind: "step", step: "check-token", title: "Check the token [redacted]", status: "started" },
      { kind: "message", level: "warning", text: "GH_TOKEN=[redacted] is old" },
      { kind: "step", step: "check-token", title: "Check the token [redacted]", status: "failed" },
    ]);
    expect(outcome).toEqual({
      ok: false,
      command: "sample login",
      exitCode: 1,
      durationMs: expect.any(Number),
      error: {
        kind: "problem",
        message: "the token [redacted] is not valid: token [redacted] is bad",
        issues: [{ field: "GH_TOKEN", message: "[redacted] has expired" }],
      },
    });
    expect(JSON.stringify([caller.updates, outcome])).not.toContain("ghp_0123456789abcdef");
  });

  test("a command's result keeps its data as it is", async () => {
    const show = defineCommand({
      path: ["sample", "show"],
      summary: "Show the GitHub token from the env.",
      input: z.object({}),
      run: (_input, context) => Promise.resolve({ token: context.env.GH_TOKEN ?? null }),
    });
    const world = fakeWorld({ env: { GH_TOKEN: "ghp_0123456789abcdef" } });
    expect(await runCommand(show, {}, frontEnd(world))).toMatchObject({
      ok: true,
      result: { token: "ghp_0123456789abcdef" },
    });
  });
});

describe("flagOf", () => {
  test("gives the field in kebab case after two dashes, with an acronym kept as one word", () => {
    expect(flagOf("host")).toBe("--host");
    expect(flagOf("dryRun")).toBe("--dry-run");
    expect(flagOf("npmURL")).toBe("--npm-url");
    expect(flagOf("URLPath")).toBe("--url-path");
    expect(flagOf("githubAPIToken")).toBe("--github-api-token");
    expect(flagOf("schemaV2")).toBe("--schema-v2");
  });
});
