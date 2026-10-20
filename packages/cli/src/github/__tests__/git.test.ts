import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import { realWorld } from "../../command/world";
import { inLocalHistory } from "../git";
import { frontEnd } from "./gh-answers";

/** A sample command that asks whether a commit is in the local history of a git repo. */
const history = defineCommand({
  path: ["sample", "in-local-history"],
  summary: "Tell whether a commit is in the local history of a git repo.",
  input: z.object({
    sha: z.string().describe("The commit's full sha."),
    localRoot: z.string().describe("The folder of the local git repo."),
  }),
  run(input, context) {
    return inLocalHistory(context, input);
  },
});

/**
 * Runs git in `folder` for a test's setup, and gives its stdout. The user's own git config stays
 * out, so a global setting such as commit signing cannot change the setup.
 */
function git(folder: string, ...words: string[]): string {
  const spawned = Bun.spawnSync(["git", "-C", folder, ...words], {
    env: { ...Bun.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (spawned.exitCode !== 0) {
    throw new Error(`git ${words.join(" ")} failed: ${spawned.stderr.toString()}`);
  }
  return spawned.stdout.toString().trim();
}

describe("inLocalHistory: a real git repo in a temp folder", () => {
  let work: string;
  /** The commits: `first` and `second` on main, where HEAD is; `side` on a branch from `first`. */
  const commits = { first: "", second: "", side: "" };

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "acmelabs-git-"));
    git(work, "init", "--initial-branch=main");
    // The commits' author, in the temp repo only.
    git(work, "config", "user.name", "ACMElabs Test");
    git(work, "config", "user.email", "test@acmelabs.invalid");
    git(work, "commit", "--allow-empty", "--message=first");
    commits.first = git(work, "rev-parse", "HEAD");
    git(work, "switch", "--create", "side");
    git(work, "commit", "--allow-empty", "--message=side");
    commits.side = git(work, "rev-parse", "HEAD");
    git(work, "switch", "main");
    git(work, "commit", "--allow-empty", "--message=second");
    commits.second = git(work, "rev-parse", "HEAD");
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test("a commit that HEAD descends from is in the local history", async () => {
    const outcome = await runCommand(
      history,
      { sha: commits.first, localRoot: work },
      frontEnd(realWorld()),
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: true });
  });

  test("HEAD's own commit is in the local history", async () => {
    const outcome = await runCommand(
      history,
      { sha: commits.second, localRoot: work },
      frontEnd(realWorld()),
    );
    expect(outcome).toMatchObject({ ok: true, result: true });
  });

  test("a commit on another branch is not in the local history", async () => {
    const outcome = await runCommand(
      history,
      { sha: commits.side, localRoot: work },
      frontEnd(realWorld()),
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: false });
  });

  test("a sha that git does not know is not in the local history", async () => {
    const outcome = await runCommand(
      history,
      { sha: "0123456789abcdef0123456789abcdef01234567", localRoot: work },
      frontEnd(realWorld()),
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: false });
  });
});

describe("inLocalHistory: the git call", () => {
  /** A commit's sha, and git's command line that asks for it. */
  const sha = "bb0c949064ca21a2a00beff42fea6d4c2d24c27e";
  const commandLine = ["git", "merge-base", "--is-ancestor", sha, "HEAD"];

  test("runs git merge-base --is-ancestor in the local root, with no variables added", async () => {
    const world = fakeWorld({ spawn: [{ commandLine, answer: { code: 0 } }] });
    const outcome = await runCommand(history, { sha, localRoot: "/work/cli" }, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: true });
    expect(world.calls).toEqual([{ kind: "spawn", commandLine, cwd: "/work/cli" }]);
  });

  test("an exit other than 0, 1 and 128 ends with exit 3, naming the command line and git's message", async () => {
    const world = fakeWorld({
      spawn: [
        {
          commandLine,
          answer: {
            code: 129,
            stderr: "usage: git merge-base [-a | --all] <commit> <commit>...\n",
          },
        },
      ],
    });
    const outcome = await runCommand(history, { sha, localRoot: "/work/cli" }, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample in-local-history",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message: `git merge-base --is-ancestor ${sha} HEAD in /work/cli failed with exit 129: usage: git merge-base [-a | --all] <commit> <commit>...`,
        issues: [],
      },
    });
  });

  test("git not installed ends with exit 3, naming git", async () => {
    const world = fakeWorld({ spawn: [{ commandLine, missing: true }] });
    const outcome = await runCommand(history, { sha, localRoot: "/work/cli" }, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: { kind: "outside", message: "git is not installed or not on PATH" },
    });
  });

  test.each([
    ["an option", "--help"],
    ["a ref name", "HEAD"],
    ["a short sha", "bb0c949"],
    ["capital letters", "BB0C949064CA21A2A00BEFF42FEA6D4C2D24C27E"],
    ["41 characters", `${sha}0`],
    ["a newline at the end", `${sha}\n`],
  ])("a sha with %s starts no git, and ends as a bug in the caller", async (_case, given) => {
    const world = fakeWorld();
    const outcome = await runCommand(
      history,
      { sha: given, localRoot: "/work/cli" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: false, exitCode: 70, error: { kind: "bug" } });
    expect(world.calls).toEqual([]);
  });
});
