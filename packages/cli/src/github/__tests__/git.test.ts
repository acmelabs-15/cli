import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { World } from "../../command/world";
import { realWorld } from "../../command/world";
import { inLocalHistory, localCommit } from "../git";
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
 * The test process's environment without its GIT_ variables. A git hook exports them, so a test
 * run in a hook would otherwise set up its repos in the hook's repo.
 */
function withoutGitVariables(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(Bun.env).filter(([name]) => !name.startsWith("GIT_")));
}

/**
 * Runs git in `folder` for a test's setup, and gives its stdout. The user's own git config stays
 * out, so a global setting such as commit signing cannot change the setup.
 */
function git(folder: string, ...words: string[]): string {
  const spawned = Bun.spawnSync(["git", "-C", folder, ...words], {
    env: { ...withoutGitVariables(), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
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

/** The GIT_ variables that the cases below point at another repo. */
type GitVariable = "GIT_DIR" | "GIT_INDEX_FILE" | "GIT_COMMON_DIR" | "GIT_REFERENCE_BACKEND";

describe("inLocalHistory: the GIT_ variables point at another repo (ADR-0016)", () => {
  /** The repo that the check asks about, and another repo that the GIT_ variables point at. */
  let work: string;
  let other: string;
  /** A home folder with no git config, so the git under test reads no global config. */
  let home: string;
  /** `first`: a commit on the work repo's main, behind HEAD. `other`: the other repo's HEAD. */
  const commits = { first: "", other: "" };

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "acmelabs-git-work-"));
    other = await mkdtemp(path.join(tmpdir(), "acmelabs-git-other-"));
    home = await mkdtemp(path.join(tmpdir(), "acmelabs-git-home-"));
    for (const folder of [work, other]) {
      git(folder, "init", "--initial-branch=main");
      git(folder, "config", "user.name", "ACMElabs Test");
      git(folder, "config", "user.email", "test@acmelabs.invalid");
    }
    git(work, "commit", "--allow-empty", "--message=first");
    commits.first = git(work, "rev-parse", "HEAD");
    git(work, "commit", "--allow-empty", "--message=second");
    // A file in the other repo, so it has an index for GIT_INDEX_FILE to point at.
    await Bun.write(path.join(other, "README.md"), "the other repo\n");
    git(other, "add", "README.md");
    git(other, "commit", "--message=other");
    commits.other = git(other, "rev-parse", "HEAD");
  });

  afterAll(async () => {
    for (const folder of [work, other, home]) {
      await rm(folder, { recursive: true, force: true });
    }
  });

  /**
   * A real World whose env is the test process's, plus the GIT_ variables `names`, each an
   * absolute path into the other repo, as a linked worktree's hook gives them. The World has its
   * own env, so the test sets no variable in the test process, and its spawn passes on that env.
   */
  function worldWith(names: readonly GitVariable[]): World {
    const gitDir = path.join(other, ".git");
    const values: Record<GitVariable, string> = {
      GIT_DIR: gitDir,
      GIT_INDEX_FILE: path.join(gitDir, "index"),
      GIT_COMMON_DIR: gitDir,
      GIT_REFERENCE_BACKEND: `files://${gitDir}`,
    };
    const variables = Object.fromEntries(names.map((name) => [name, values[name]]));
    return realWorld({ env: { ...Bun.env, HOME: home, XDG_CONFIG_HOME: home, ...variables } });
  }

  test.each<[readonly GitVariable[]]>([
    [["GIT_DIR"]],
    // merge-base reads no index, so this case passes with the variable kept too (note 12, section
    // 1.3): it shows that the variable does not break the check.
    [["GIT_INDEX_FILE"]],
    [["GIT_COMMON_DIR"]],
    // Not in git's own list of local variables (note 12, section 1.1): a removal of only that list
    // keeps it, and the check then says no for the work repo's own commit.
    [["GIT_REFERENCE_BACKEND"]],
    [["GIT_DIR", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]],
  ])(
    "with %p pointing at another repo, the check answers for the repo it asks about",
    async (names) => {
      const world = worldWith(names);
      const otherHead = await runCommand(
        history,
        { sha: commits.other, localRoot: work },
        frontEnd(world),
      );
      const ownCommit = await runCommand(
        history,
        { sha: commits.first, localRoot: work },
        frontEnd(world),
      );
      // The other repo's HEAD is not in the work repo's history; the work repo's own commit is.
      expect(otherHead).toMatchObject({ ok: true, exitCode: 0, result: false });
      expect(ownCommit).toMatchObject({ ok: true, exitCode: 0, result: true });
    },
  );
});

describe("inLocalHistory: the git call", () => {
  /** A commit's sha, and git's command line that asks for it. */
  const sha = "bb0c949064ca21a2a00beff42fea6d4c2d24c27e";
  const commandLine = ["git", "merge-base", "--is-ancestor", sha, "HEAD"];

  test("runs git merge-base --is-ancestor in the local root, without the GIT_ variables, with GIT_TERMINAL_PROMPT=0", async () => {
    const world = fakeWorld({
      env: {
        // A linked worktree's commit hook gives GIT_DIR and an absolute GIT_INDEX_FILE.
        GIT_DIR: "/work/other/.git/worktrees/wt",
        GIT_INDEX_FILE: "/work/other/.git/worktrees/wt/index",
        // Neither is in git's own list of local variables, and each one moves a git call (note
        // 12, section 1.3).
        GIT_REFERENCE_BACKEND: "files:///work/other/.git",
        GIT_CONFIG_GLOBAL: "/work/other/pushurl.gitconfig",
        GIT_TERMINAL_PROMPT: "1",
        GITHUB_TOKEN: "ghs_test",
        HOME: "/Users/test",
      },
      spawn: [{ commandLine, answer: { code: 0 } }],
    });
    const outcome = await runCommand(history, { sha, localRoot: "/work/cli" }, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: true });
    // toStrictEqual, so a removed variable must be there as undefined. GITHUB_TOKEN and HOME do
    // not start with GIT_, so the call leaves them in the environment the program gets.
    expect(world.calls).toStrictEqual([
      {
        kind: "spawn",
        commandLine,
        cwd: "/work/cli",
        env: {
          GIT_DIR: undefined,
          GIT_INDEX_FILE: undefined,
          GIT_REFERENCE_BACKEND: undefined,
          GIT_CONFIG_GLOBAL: undefined,
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    ]);
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

  test("a sha with a bidi mark and a C1 control names them as escapes in the bug's message", async () => {
    const world = fakeWorld();
    const outcome = await runCommand(
      history,
      { sha: "bb0c949\u202E\u009B2J", localRoot: "/work/cli" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 70,
      error: {
        kind: "bug",
        message: expect.stringContaining(
          String.raw`inLocalHistory takes a full commit sha, not "bb0c949\u202e\u009b2J"`,
        ),
      },
    });
  });
});

/** A sample command that reads the commit of a local branch, with no check of its own. */
const branchCommit = defineCommand({
  path: ["sample", "local-commit"],
  summary: "Read the commit of a branch of a local git repo.",
  input: z.object({
    cwd: z.string().describe("The folder of the local git repo."),
    branch: z.string().describe("The branch."),
  }),
  run(input, context) {
    return localCommit(context, input).then((sha) => sha ?? null);
  },
});

describe("the git calls about a branch", () => {
  test.each([
    ["a refspec that deletes", ":main"],
    ["revision syntax", "main~1"],
    ["a control character", "main\n"],
  ])("a branch with %s starts no git, and ends as a bug in the caller", async (_case, branch) => {
    const world = fakeWorld();
    const outcome = await runCommand(branchCommit, { cwd: "/work/cli", branch }, frontEnd(world));
    expect(outcome).toMatchObject({ ok: false, exitCode: 70, error: { kind: "bug" } });
    expect(world.calls).toEqual([]);
  });

  test("a branch with a bidi mark and a C1 control names them as escapes in the bug's message", async () => {
    const world = fakeWorld();
    const outcome = await runCommand(
      branchCommit,
      { cwd: "/work/cli", branch: "main\u202E\u009B2J" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 70,
      error: {
        kind: "bug",
        message: expect.stringContaining(
          String.raw`git.ts takes a checked branch name, not "main\u202e\u009b2J"`,
        ),
      },
    });
  });
});
