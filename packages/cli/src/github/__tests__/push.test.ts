import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import type { ProgressUpdate } from "../../command/command";
import { defineCommand } from "../../command/command";
import type { ScriptedSpawn, WorldCall } from "../../command/fake-world";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { Spawned, World } from "../../command/world";
import { realWorld } from "../../command/world";
import { clone, push } from "../push";
import { frontEnd } from "./gh-answers";

/** A sample command that pushes a branch of a local git repo to a GitHub repo. */
const pushCommand = defineCommand({
  path: ["sample", "push"],
  summary: "Push a branch of a local git repo to a GitHub repo.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
    cwd: z.string().describe("The folder of the local git repo."),
    branch: z.string().describe("The branch to push."),
  }),
  run(input, context) {
    const { owner, name, ...request } = input;
    return push(context, { repo: { owner, name }, ...request });
  },
});

/** The push step for acmelabs-15/jev's main branch, with one status. */
function pushStep(
  status: "started" | "done" | "failed" | "skipped",
  detail?: string,
): ProgressUpdate {
  const step = {
    kind: "step",
    step: "github-push",
    title: "Push main to acmelabs-15/jev",
    status,
  } as const;
  return detail === undefined ? step : { ...step, detail };
}

/** The local git repo of every sample push. */
const cwd = "/work/jev";

/** The local commit of main, and another commit that GitHub's main can be at. */
const localSha = "bb0c949064ca21a2a00beff42fea6d4c2d24c27e";
const otherSha = "fccb32af385e718a558b4cc5738c393fab216059";

/**
 * The words that every git call to GitHub puts before its subcommand, written out here, not taken
 * from `git.ts`, so a test fails when `git.ts` drifts: gh's credential helper for github.com, as
 * gh gives it to git for a clone (note 09, section 1.5), and no askpass program.
 */
const ghLoginWords = [
  "-c",
  "credential.https://github.com.helper=",
  "-c",
  "credential.https://github.com.helper=!gh auth git-credential",
  "-c",
  "core.askPass=",
];

/** The git command line of each call that the push step makes for acmelabs-15/jev's main. */
const lines = {
  localCommit: ["git", "rev-parse", "--verify", "--quiet", "refs/heads/main"],
  origin: ["git", "config", "--null", "--get-regexp", "^remote\\.origin\\.(url|pushurl)$"],
  addOrigin: ["git", "remote", "add", "origin", "https://github.com/acmelabs-15/jev.git"],
  fetchUrl: ["git", "remote", "get-url", "--all", "origin"],
  pushUrl: ["git", "remote", "get-url", "--push", "--all", "origin"],
  remoteCommit: ["git", ...ghLoginWords, "ls-remote", "origin", "refs/heads/main"],
  push: ["git", ...ghLoginWords, "push", "--set-upstream", "origin", "refs/heads/main"],
} as const;

/** The name of a git call of the push step. */
type Line = keyof typeof lines;

/** A scripted answer to one git call: its exit code, and its stdout and stderr. */
function git(line: Line, answer: Partial<Spawned> = {}): ScriptedSpawn {
  return { commandLine: lines[line], answer };
}

/**
 * fakeWorld's log entry for one git call in the local repo. The fake World's env holds no GIT_
 * variable, so the call only adds GIT_TERMINAL_PROMPT=0 (ADR-0016).
 */
function logged(line: Line): WorldCall {
  return { kind: "spawn", commandLine: lines[line], cwd, env: { GIT_TERMINAL_PROMPT: "0" } };
}

/** The sample push of acmelabs-15/jev's main from the local repo. */
const jevMain = { owner: "acmelabs-15", name: "jev", cwd, branch: "main" };

/**
 * git config's answer, with --null, for the origin keys that the local repo holds: each key, a
 * newline, its value and a NUL. git writes each key in lower case.
 */
function configured(...entries: [key: "url" | "pushurl", value: string][]): string {
  return entries.map(([key, value]) => `remote.origin.${key}\n${value}\0`).join("");
}

/** git config's answer for a local repo whose origin is acmelabs-15/jev's HTTPS URL. */
const jevOrigin = configured(["url", "https://github.com/acmelabs-15/jev.git"]);

/**
 * git remote get-url's answers when no rewrite in git's config moves origin: the fetch URL, then
 * the push URL, each acmelabs-15/jev's HTTPS URL, one URL a line.
 */
const originInUse = [
  git("fetchUrl", { stdout: "https://github.com/acmelabs-15/jev.git\n" }),
  git("pushUrl", { stdout: "https://github.com/acmelabs-15/jev.git\n" }),
];

/** fakeWorld's log entries for the two reads of the URLs that git uses for origin. */
const loggedOriginInUse = [logged("fetchUrl"), logged("pushUrl")];

/**
 * git's answers to its calls to GitHub. Each one is real, from the probes of github-ops task 11
 * on 2026-10-20 (`git ls-remote` with gh's login words, read-only), or from a local bare repo,
 * with the URL changed to jev's, unless its comment says it is built.
 */
const gitAnswers = {
  /** No repo at the URL for the gh login: an acmelabs-15 repo that does not exist. */
  repoNotFound: {
    code: 128,
    stdout: "",
    stderr:
      "remote: Repository not found.\nfatal: repository 'https://github.com/acmelabs-15/jev.git/' not found\n",
  },
  /** No login: gh's helper gives git nothing, and git may not ask on the terminal. */
  noLogin: {
    code: 128,
    stdout: "",
    stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
  },
  /** A token that GitHub rejects: gh's helper with GH_TOKEN=not-a-real-token. */
  badToken: {
    code: 128,
    stdout: "",
    stderr:
      "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/acmelabs-15/jev.git/'\n",
  },
  /** A push that is not a fast-forward: GitHub's branch has a commit that the local one lacks. */
  notFastForward: {
    code: 1,
    stdout: "",
    stderr:
      "To https://github.com/acmelabs-15/jev.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'https://github.com/acmelabs-15/jev.git'\nhint: Updates were rejected because the remote contains work that you do not\nhint: have locally.\n",
  },
  /** Built: GitHub refuses a push for a rule of a ruleset, from reports of GH013. */
  ruleViolation: {
    code: 1,
    stdout: "",
    stderr:
      "remote: error: GH013: Repository rule violations found for refs/heads/main.\nremote: - Changes must be made through a pull request.\nTo https://github.com/acmelabs-15/jev.git\n ! [remote rejected] main -> main (push declined due to repository rule violations)\nerror: failed to push some refs to 'https://github.com/acmelabs-15/jev.git'\n",
  },
  /** Built: the push of a workflow file without the `workflow` scope (note 09, section 4). */
  workflowScope: {
    code: 1,
    stdout: "",
    stderr:
      "To https://github.com/acmelabs-15/jev.git\n ! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/release.yml` without `workflow` scope)\nerror: failed to push some refs to 'https://github.com/acmelabs-15/jev.git'\n",
  },
  /** Built: a login that may read the repo but not push to it, from reports of GitHub's 403. */
  noPushAccess: {
    code: 128,
    stdout: "",
    stderr:
      "remote: Permission to acmelabs-15/jev.git denied to octocat.\nfatal: unable to access 'https://github.com/acmelabs-15/jev.git/': The requested URL returned error: 403\n",
  },
  /** Built: no network, with curl's message for a name that does not resolve. */
  noNetwork: {
    code: 128,
    stdout: "",
    stderr:
      "fatal: unable to access 'https://github.com/acmelabs-15/jev.git/': Could not resolve host: github.com\n",
  },
} satisfies Record<string, Spawned>;

/** The scripted answers before the push itself: main at the local commit, origin, a new repo. */
const beforePush = [
  git("localCommit", { stdout: `${localSha}\n` }),
  git("origin", { stdout: jevOrigin }),
  ...originInUse,
  git("remoteCommit"),
];

/** fakeWorld's log entries for the calls before the push itself. */
const loggedBeforePush = [
  logged("localCommit"),
  logged("origin"),
  ...loggedOriginInUse,
  logged("remoteCommit"),
];

describe("push: the remote origin", () => {
  test("no origin gets the HTTPS URL added, and a new branch is pushed through gh's login", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        // git config exits 1, with no output, for a key that it does not find.
        git("origin", { code: 1 }),
        git("addOrigin"),
        ...originInUse,
        // A new repo has no branches, so ls-remote prints nothing.
        git("remoteCommit"),
        git("push", {
          stderr:
            "To https://github.com/acmelabs-15/jev.git\n * [new branch]      main -> main\nbranch 'main' set up to track 'origin/main'.\n",
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, jevMain, caller);
    expect(outcome).toEqual({
      ok: true,
      command: "sample push",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: { sha: localSha, pushed: true },
    });
    expect(caller.updates).toEqual([pushStep("started"), pushStep("done")]);
    expect(world.calls).toEqual([
      logged("localCommit"),
      logged("origin"),
      logged("addOrigin"),
      ...loggedOriginInUse,
      logged("remoteCommit"),
      logged("push"),
    ]);
  });

  test("an origin whose push URL is the HTTPS URL too stays as it is", async () => {
    const jev = "https://github.com/acmelabs-15/jev.git";
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: configured(["url", jev], ["pushurl", jev]) }),
        ...originInUse,
        git("remoteCommit"),
        git("push"),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { sha: localSha, pushed: true } });
  });

  test("an origin that is the HTTPS URL stays as it is", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit"),
        git("push"),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { sha: localSha, pushed: true } });
    expect(world.calls).toEqual([
      logged("localCommit"),
      logged("origin"),
      ...loggedOriginInUse,
      logged("remoteCommit"),
      logged("push"),
    ]);
  });

  test.each([
    [
      "the SSH form of the repo",
      configured(["url", "git@github.com:acmelabs-15/jev.git"]),
      "git@github.com:acmelabs-15/jev.git",
    ],
    [
      "another repo",
      configured(["url", "https://github.com/acmelabs-15/brain.git"]),
      "https://github.com/acmelabs-15/brain.git",
    ],
    [
      "the HTTPS URL beside another URL",
      configured(["url", "https://github.com/acmelabs-15/jev.git"], ["url", "/work/backup.git"]),
      "https://github.com/acmelabs-15/jev.git, /work/backup.git",
    ],
    [
      "the HTTPS URL with a push URL elsewhere",
      configured(
        ["url", "https://github.com/acmelabs-15/jev.git"],
        ["pushurl", "/work/backup.git"],
      ),
      "https://github.com/acmelabs-15/jev.git, /work/backup.git (push URL)",
    ],
    [
      "only a push URL",
      configured(["pushurl", "https://github.com/acmelabs-15/jev.git"]),
      "https://github.com/acmelabs-15/jev.git (push URL)",
    ],
    [
      "a URL with a token in it, which the message leaves out",
      configured(["url", "https://x-access-token:ghp_secret0@github.com/acmelabs-15/jev.git"]),
      "https://github.com/acmelabs-15/jev.git",
    ],
  ])(
    "an origin that is %s ends with exit 2, naming the folder and both URLs, and reaches no remote",
    async (_case, answer, found) => {
      const world = fakeWorld({
        spawn: [git("localCommit", { stdout: `${localSha}\n` }), git("origin", { stdout: answer })],
      });
      const caller = frontEnd(world);
      const outcome = await runCommand(pushCommand, jevMain, caller);
      expect(JSON.stringify(outcome)).not.toContain("ghp_secret0");
      expect(outcome).toEqual({
        ok: false,
        command: "sample push",
        exitCode: 2,
        durationMs: expect.any(Number),
        error: {
          kind: "input",
          message: `the remote origin of /work/jev is ${found}, not https://github.com/acmelabs-15/jev.git; acmelabs pushes acmelabs-15/jev only to its HTTPS URL, so point origin at that URL, or push from another folder`,
          issues: [],
        },
      });
      expect(caller.updates).toEqual([pushStep("started"), pushStep("failed")]);
      expect(world.calls).toEqual([logged("localCommit"), logged("origin")]);
    },
  );
});

describe("push: the remote origin's message", () => {
  test("the folder and a URL from git config show on one line in the message", async () => {
    // The folder comes from the caller as given, and the URL from the local git config, which can
    // hold a control character.
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", {
          stdout: configured(["url", "git@github.com:acmelabs-15/jev.git\u001B[2J"]),
        }),
      ],
    });
    const outcome = await runCommand(
      pushCommand,
      { ...jevMain, cwd: "/work/jev\u001B[2J" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "the remote origin of /work/jev [2J is git@github.com:acmelabs-15/jev.git [2J, not https://github.com/acmelabs-15/jev.git; acmelabs pushes acmelabs-15/jev only to its HTTPS URL, so point origin at that URL, or push from another folder",
      },
    });
  });
});

/** The message for a rewrite of jev's origin to `shown`, the URL that git would use. */
function rewritten(shown: string): string {
  return `git's config rewrites the remote origin of /work/jev, https://github.com/acmelabs-15/jev.git, to ${shown}; acmelabs pushes acmelabs-15/jev only to that HTTPS URL, with gh's login, so remove the rewrite (git config --show-origin --get-regexp '^url\\.' lists each one)`;
}

describe("push: a rewrite in git's config", () => {
  // Each answer is git 2.54.0's, from the probes of the review fix on 2026-10-20 (note 09,
  // section 4): `url.<base>.insteadOf` moves the fetch URL and the push URL, `pushInsteadOf`
  // moves the push URL alone, and a `pushInsteadOf` back to github.com can keep the push URL
  // while `insteadOf` moves the fetch URL, which `git ls-remote origin` reads.
  test.each([
    [
      "insteadOf moves both URLs to another host",
      "https://evil.example/acmelabs-15/jev.git\n",
      "https://evil.example/acmelabs-15/jev.git\n",
      "https://evil.example/acmelabs-15/jev.git",
    ],
    [
      "pushInsteadOf moves the push URL to another host",
      "https://github.com/acmelabs-15/jev.git\n",
      "https://evil.example/acmelabs-15/jev.git\n",
      "https://evil.example/acmelabs-15/jev.git (push URL)",
    ],
    [
      "insteadOf moves the fetch URL and pushInsteadOf keeps the push URL",
      "https://evil.example/acmelabs-15/jev.git\n",
      "https://github.com/acmelabs-15/jev.git\n",
      "https://evil.example/acmelabs-15/jev.git",
    ],
    [
      "a global rewrite gives the SSH form, which would skip gh's login",
      "git@github.com:acmelabs-15/jev.git\n",
      "git@github.com:acmelabs-15/jev.git\n",
      "git@github.com:acmelabs-15/jev.git",
    ],
    [
      "a rewrite gives a URL with a login part, which the message leaves out",
      "https://x-access-token:ghp_secret0@evil.example/acmelabs-15/jev.git\n",
      "https://x-access-token:ghp_secret0@evil.example/acmelabs-15/jev.git\n",
      "https://evil.example/acmelabs-15/jev.git",
    ],
  ])(
    "an origin that %s ends with exit 2, naming the URL that git would use, and reaches no remote",
    async (_case, fetchUrl, pushUrl, shown) => {
      const world = fakeWorld({
        spawn: [
          git("localCommit", { stdout: `${localSha}\n` }),
          git("origin", { stdout: jevOrigin }),
          git("fetchUrl", { stdout: fetchUrl }),
          git("pushUrl", { stdout: pushUrl }),
        ],
      });
      const caller = frontEnd(world);
      const outcome = await runCommand(pushCommand, jevMain, caller);
      expect(JSON.stringify(outcome)).not.toContain("ghp_secret0");
      expect(outcome).toEqual({
        ok: false,
        command: "sample push",
        exitCode: 2,
        durationMs: expect.any(Number),
        error: { kind: "input", message: rewritten(shown), issues: [] },
      });
      expect(caller.updates).toEqual([pushStep("started"), pushStep("failed")]);
      expect(world.calls).toEqual([
        logged("localCommit"),
        logged("origin"),
        logged("fetchUrl"),
        logged("pushUrl"),
      ]);
    },
  );

  test("an origin that the step adds and a rewrite moves ends with exit 2, and reaches no remote", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { code: 1 }),
        git("addOrigin"),
        git("fetchUrl", { stdout: "git@github.com:acmelabs-15/jev.git\n" }),
        git("pushUrl", { stdout: "git@github.com:acmelabs-15/jev.git\n" }),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: { kind: "input", message: rewritten("git@github.com:acmelabs-15/jev.git") },
    });
    expect(world.calls).toEqual([
      logged("localCommit"),
      logged("origin"),
      logged("addOrigin"),
      logged("fetchUrl"),
      logged("pushUrl"),
    ]);
  });

  test("a read of the URLs that git uses that fails ends with exit 3, naming the call and git's message", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        git("fetchUrl", { code: 128, stderr: "fatal: bad config line 3 in file .git/config\n" }),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "git remote get-url --all origin in /work/jev failed with exit 128: fatal: bad config line 3 in file .git/config",
      },
    });
    expect(world.calls).toEqual([logged("localCommit"), logged("origin"), logged("fetchUrl")]);
  });
});

describe("push: GitHub's branch", () => {
  test("a branch already at the local commit gives a skipped step, and no push", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        // ls-remote matches the end of each ref, so another ref that ends the same is listed too.
        git("remoteCommit", {
          stdout: `${otherSha}\trefs/heads/old/refs/heads/main\n${localSha}\trefs/heads/main\n`,
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, jevMain, caller);
    expect(outcome).toMatchObject({ ok: true, result: { sha: localSha, pushed: false } });
    expect(caller.updates).toEqual([
      pushStep("started"),
      pushStep("skipped", `already at ${localSha}`),
    ]);
    expect(world.calls).toEqual([
      logged("localCommit"),
      logged("origin"),
      ...loggedOriginInUse,
      logged("remoteCommit"),
    ]);
  });

  test("git's commit shows on one line in the skipped step's detail", async () => {
    // Built: git's output is a text from outside, and the detail reaches a terminal.
    const odd = `${localSha}\u001B[2J`;
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${odd}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit", { stdout: `${odd}\trefs/heads/main\n` }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, jevMain, caller);
    expect(outcome).toMatchObject({ ok: true, result: { sha: odd, pushed: false } });
    expect(caller.updates).toEqual([
      pushStep("started"),
      pushStep("skipped", `already at ${localSha} [2J`),
    ]);
  });

  test("a branch at another commit is pushed", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit", { stdout: `${otherSha}\trefs/heads/main\n` }),
        git("push"),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, jevMain, caller);
    expect(outcome).toMatchObject({ ok: true, result: { sha: localSha, pushed: true } });
    expect(caller.updates).toEqual([pushStep("started"), pushStep("done")]);
  });

  test("a push runs without the GIT_ variables, with GIT_TERMINAL_PROMPT=0, and gh's helper", async () => {
    const world = fakeWorld({
      env: {
        // A linked worktree's commit hook gives GIT_DIR and an absolute GIT_INDEX_FILE; GIT_CONFIG_GLOBAL
        // with a pushurl and GIT_ASKPASS each move or change a push (note 12, section 1.3).
        GIT_DIR: "/work/other/.git/worktrees/wt",
        GIT_INDEX_FILE: "/work/other/.git/worktrees/wt/index",
        GIT_CONFIG_GLOBAL: "/work/other/pushurl.gitconfig",
        GIT_ASKPASS: "/usr/libexec/ssh-askpass",
        GITHUB_TOKEN: "ghs_test",
        HOME: "/Users/test",
      },
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit"),
        git("push"),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { pushed: true } });
    // toStrictEqual, so a removed variable must be there as undefined. GITHUB_TOKEN and HOME do
    // not start with GIT_, so they stay: gh's credential helper reads GITHUB_TOKEN.
    const env = {
      GIT_DIR: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_CONFIG_GLOBAL: undefined,
      GIT_ASKPASS: undefined,
      GIT_TERMINAL_PROMPT: "0",
    };
    expect(world.calls).toStrictEqual(
      (["localCommit", "origin", "fetchUrl", "pushUrl", "remoteCommit", "push"] as const).map(
        (line) => ({
          kind: "spawn",
          commandLine: lines[line],
          cwd,
          env,
        }),
      ),
    );
  });
});

describe("push: GitHub rejects the push", () => {
  // git's message shows on one line, each line break as a space, and stops at 300 characters:
  // the rule violation's message has 332, so its cut falls inside the last URL,
  // which is dropped.
  test.each([
    [
      "is not a fast-forward",
      gitAnswers.notFastForward,
      "To https://github.com/acmelabs-15/jev.git  ! [rejected]        main -> main (fetch first) error: failed to push some refs to 'https://github.com/acmelabs-15/jev.git' hint: Updates were rejected because the remote contains work that you do not hint: have locally.",
    ],
    [
      "breaks a rule of a ruleset",
      gitAnswers.ruleViolation,
      "remote: error: GH013: Repository rule violations found for refs/heads/main. remote: - Changes must be made through a pull request. To https://github.com/acmelabs-15/jev.git  ! [remote rejected] main -> main (push declined due to repository rule violations) error: failed to push some refs to...",
    ],
  ])(
    "a push that %s ends with exit 1 and git's message on one line, and is not forced",
    async (_case, answer, shown) => {
      const world = fakeWorld({ spawn: [...beforePush, git("push", answer)] });
      const caller = frontEnd(world);
      const outcome = await runCommand(pushCommand, jevMain, caller);
      expect(outcome).toEqual({
        ok: false,
        command: "sample push",
        exitCode: 1,
        durationMs: expect.any(Number),
        error: {
          kind: "problem",
          message: `GitHub rejected git push --set-upstream origin refs/heads/main in /work/jev, and acmelabs never forces a push: ${shown}`,
          issues: [],
        },
      });
      expect(caller.updates).toEqual([pushStep("started"), pushStep("failed")]);
      // One push, and no second one with --force.
      expect(world.calls).toEqual([...loggedBeforePush, logged("push")]);
    },
  );

  test("a push of a workflow file without the workflow scope ends with exit 4, naming gh auth refresh", async () => {
    const world = fakeWorld({ spawn: [...beforePush, git("push", gitAnswers.workflowScope)] });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s workflow, then run the command again",
      },
    });
    expect(world.calls).toEqual([...loggedBeforePush, logged("push")]);
  });

  test("the workflow scope missing from a token in GITHUB_TOKEN names GITHUB_TOKEN, then gh auth refresh after it is cleared", async () => {
    // As in CI: a token in GITHUB_TOKEN, which gh's helper serves, and gh auth refresh refuses
    // to run while it is set (note 09, section 1.4).
    const world = fakeWorld({
      env: { GITHUB_TOKEN: "also-not-a-real-token" },
      spawn: [...beforePush, git("push", gitAnswers.workflowScope)],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; give the workflow scope to the token in GITHUB_TOKEN, or clear GITHUB_TOKEN and run gh auth refresh -h github.com -s workflow, then run the command again",
      },
    });
  });

  test("a login that may not push ends with exit 2, naming the repo and git's message on one line", async () => {
    const world = fakeWorld({ spawn: [...beforePush, git("push", gitAnswers.noPushAccess)] });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "GitHub refused git push --set-upstream origin refs/heads/main in /work/jev for the gh login, which needs more access to acmelabs-15/jev: remote: Permission to acmelabs-15/jev.git denied to octocat. fatal: unable to access 'https://github.com/acmelabs-15/jev.git/': The requested URL returned error: 403",
      },
    });
  });
});

describe("push: git's answers on the way to GitHub", () => {
  test.each([
    ["no gh login", gitAnswers.noLogin],
    ["a token that GitHub rejects", gitAnswers.badToken],
  ])("%s ends with exit 4, naming gh auth login, and makes no push", async (_case, answer) => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit", answer),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, jevMain, caller);
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
      },
    });
    expect(caller.updates).toEqual([pushStep("started"), pushStep("failed")]);
    expect(world.calls).toEqual(loggedBeforePush);
  });

  test("a token from GH_TOKEN that GitHub rejects ends with exit 4, naming GH_TOKEN, then gh auth login after it is cleared", async () => {
    // The probe of github-ops task 11: gh's helper with GH_TOKEN=not-a-real-token. gh auth login
    // refuses to run while GH_TOKEN is set (note 09, section 1.4).
    const world = fakeWorld({
      env: { GH_TOKEN: "not-a-real-token" },
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit", gitAnswers.badToken),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample push",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message:
          "gh needs a login; replace the token in GH_TOKEN, or clear GH_TOKEN and run gh auth login, then run the command again",
        issues: [],
      },
    });
    expect(world.calls).toEqual(loggedBeforePush);
  });

  test("Repository not found, then the branch, pushes after one 3-second wait", async () => {
    // Right after a create, GitHub can answer so for a few seconds (note 09, section 3.1).
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit", gitAnswers.repoNotFound),
        git("remoteCommit"),
        git("push"),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { sha: localSha, pushed: true } });
    expect(world.calls).toEqual([
      logged("localCommit"),
      logged("origin"),
      ...loggedOriginInUse,
      logged("remoteCommit"),
      { kind: "sleep", ms: 3000 },
      logged("remoteCommit"),
      logged("push"),
    ]);
  });

  test("Repository not found on every try ends with exit 2 after three waits, naming the repo", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        ...Array.from({ length: 4 }, () => git("remoteCommit", gitAnswers.repoNotFound)),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, jevMain, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample push",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          "GitHub found no repo acmelabs-15/jev for the gh login (Repository not found, on git ls-remote origin refs/heads/main in /work/jev); check the owner and the name, and the login's access to the repo",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([pushStep("started"), pushStep("failed")]);
    const retry: WorldCall[] = [{ kind: "sleep", ms: 3000 }, logged("remoteCommit")];
    expect(world.calls).toEqual([
      logged("localCommit"),
      logged("origin"),
      ...loggedOriginInUse,
      logged("remoteCommit"),
      ...retry,
      ...retry,
      ...retry,
    ]);
  });

  test("a push that meets Repository not found is tried again, as the read is", async () => {
    const world = fakeWorld({
      spawn: [...beforePush, git("push", gitAnswers.repoNotFound), git("push")],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { pushed: true } });
    expect(world.calls).toEqual([
      ...loggedBeforePush,
      logged("push"),
      { kind: "sleep", ms: 3000 },
      logged("push"),
    ]);
  });

  test("no network ends with exit 3, naming the call and git's message, with no wait", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit", gitAnswers.noNetwork),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "git ls-remote origin refs/heads/main in /work/jev failed with exit 128: fatal: unable to access 'https://github.com/acmelabs-15/jev.git/': Could not resolve host: github.com",
      },
    });
    expect(world.calls).toEqual(loggedBeforePush);
  });

  test("git's message in an outside failure shows on one line, with no bidi mark, and stops at 300 characters", async () => {
    // Built: curl's message through git, then a long line, as a proxy's answer can give it.
    const world = fakeWorld({
      spawn: [
        git("localCommit", { stdout: `${localSha}\n` }),
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        git("remoteCommit", {
          code: 128,
          stderr: `fatal: unable to access 'https://github.com/acmelabs-15/jev.git/': Could not resolve host\r\n\u202E${"x".repeat(400)}\n`,
        }),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    // The first 300 characters: the 89 of curl's message, one space, then 210 x, a part of a
    // word, which is dropped.
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "git ls-remote origin refs/heads/main in /work/jev failed with exit 128: fatal: unable to access 'https://github.com/acmelabs-15/jev.git/': Could not resolve host...",
      },
    });
  });
});

describe("push: the names", () => {
  test.each([
    ["an option", "-f"],
    ["a refspec with a colon", "main:other"],
    ["a refspec that deletes", ":main"],
    ["a pattern", "release/*"],
    ["revision syntax", "main~1"],
    ["a reflog entry", "main@{1}"],
    ["two dots", "main..next"],
    ["a space", "my branch"],
    ["a control character", "main\u001B[2J"],
    ["a newline", "main\n"],
    ["a part that starts with a dot", "feature/.hidden"],
    ["a part that ends with .lock", "main.lock"],
    ["a slash at the end", "main/"],
    ["two slashes", "a//b"],
    ["HEAD", "HEAD"],
    ["no character", ""],
    ["a bidi mark, which git allows but a terminal shows reordered", "main\u202E"],
    ["a lone surrogate, one half of a UTF-16 pair", "main\uD800"],
  ])(
    "a branch with %s ends with exit 2 before the step starts, and makes no call",
    async (_case, branch) => {
      const world = fakeWorld();
      const caller = frontEnd(world);
      const outcome = await runCommand(pushCommand, { ...jevMain, branch }, caller);
      expect(outcome).toMatchObject({
        ok: false,
        exitCode: 2,
        error: {
          kind: "input",
          message: "the branch to push is not a branch name that git allows",
          issues: [{ field: "branch" }],
        },
      });
      expect(caller.updates).toEqual([]);
      expect(world.calls).toEqual([]);
    },
  );

  test("a refused branch shows its bidi mark and C1 control as escapes in the issue", async () => {
    const world = fakeWorld();
    const outcome = await runCommand(
      pushCommand,
      { ...jevMain, branch: "main\u202E\u009B2J" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        issues: [
          {
            field: "branch",
            message: expect.stringMatching(
              /^"main\\u202e\\u009b2J" is not a branch name that git allows: /u,
            ),
          },
        ],
      },
    });
    expect(world.calls).toEqual([]);
  });

  test("a branch that starts with + goes into each command line as a full ref, so no push is forced", async () => {
    const plus = "refs/heads/+main";
    const world = fakeWorld({
      spawn: [
        {
          commandLine: ["git", "rev-parse", "--verify", "--quiet", plus],
          answer: { stdout: localSha },
        },
        git("origin", { stdout: jevOrigin }),
        ...originInUse,
        { commandLine: ["git", ...ghLoginWords, "ls-remote", "origin", plus] },
        { commandLine: ["git", ...ghLoginWords, "push", "--set-upstream", "origin", plus] },
      ],
    });
    const outcome = await runCommand(pushCommand, { ...jevMain, branch: "+main" }, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { sha: localSha, pushed: true } });
  });

  test("a repo name that fails the name check ends with exit 2 before the step starts, and makes no call", async () => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, { ...jevMain, name: "jev.git/../x" }, caller);
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: { kind: "input", message: '"acmelabs-15/jev.git/../x" is not a GitHub repo' },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });
});

describe("push: the local repo", () => {
  test("a local repo with no such branch ends with exit 2, and reaches no remote", async () => {
    // rev-parse --verify --quiet exits 1, with no message, for a ref that does not exist.
    const world = fakeWorld({ spawn: [git("localCommit", { code: 1 })] });
    const caller = frontEnd(world);
    const outcome = await runCommand(pushCommand, jevMain, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample push",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: { kind: "input", message: "/work/jev has no branch main to push", issues: [] },
    });
    expect(caller.updates).toEqual([pushStep("started"), pushStep("failed")]);
    expect(world.calls).toEqual([logged("localCommit")]);
  });

  test("a folder with control characters shows on one line in the message, and git gets the folder as given", async () => {
    // A folder comes from the caller as given, and a terminal shows the message.
    const oddCwd = "/work/jev\r\n\u001B[2J";
    const world = fakeWorld({ spawn: [git("localCommit", { code: 1 })] });
    const outcome = await runCommand(pushCommand, { ...jevMain, cwd: oddCwd }, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: { kind: "input", message: "/work/jev [2J has no branch main to push" },
    });
    expect(world.calls).toEqual([
      {
        kind: "spawn",
        commandLine: lines.localCommit,
        cwd: oddCwd,
        env: { GIT_TERMINAL_PROMPT: "0" },
      },
    ]);
  });

  test("a folder with no git repo ends with exit 3, naming the call and git's message", async () => {
    const world = fakeWorld({
      spawn: [
        git("localCommit", {
          code: 128,
          stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
        }),
      ],
    });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "git rev-parse --verify --quiet refs/heads/main in /work/jev failed with exit 128: fatal: not a git repository (or any of the parent directories): .git",
      },
    });
  });

  test("git not installed ends with exit 3, naming git", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: lines.localCommit, missing: true }] });
    const outcome = await runCommand(pushCommand, jevMain, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: { kind: "outside", message: "git is not installed or not on PATH" },
    });
  });
});

/** A sample command that clones a GitHub repo into a new folder. */
const cloneCommand = defineCommand({
  path: ["sample", "clone"],
  summary: "Clone a GitHub repo into a new folder.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
    into: z.string().describe("The new folder."),
  }),
  run(input, context) {
    const { owner, name, into } = input;
    return clone(context, { repo: { owner, name }, into });
  },
});

/** The clone step for acmelabs-15/marketplace into a folder, with one status. */
function cloneStep(into: string, status: "started" | "done" | "failed"): ProgressUpdate {
  return {
    kind: "step",
    step: "github-clone",
    title: `Clone acmelabs-15/marketplace into ${into}`,
    status,
  };
}

/** A folder that does not exist: the fake World's root is one too. */
const newFolder = "/fake-world/marketplace";

/** git's command line that clones acmelabs-15/marketplace into the new folder. */
const cloneLine = [
  "git",
  ...ghLoginWords,
  "clone",
  "--",
  "https://github.com/acmelabs-15/marketplace.git",
  newFolder,
];

/** fakeWorld's log entry for the clone: no folder to run in, and GIT_TERMINAL_PROMPT=0. */
const loggedClone: WorldCall = {
  kind: "spawn",
  commandLine: cloneLine,
  env: { GIT_TERMINAL_PROMPT: "0" },
};

/**
 * git's command line that reads the URL that a clone of acmelabs-15/marketplace uses, after the
 * rewrites in git's config. It reaches no remote, so it has no login words.
 */
const cloneUrlLine = [
  "git",
  "--git-dir=/dev/null",
  "ls-remote",
  "--get-url",
  "https://github.com/acmelabs-15/marketplace.git",
];

/** git's answer when no rewrite moves the marketplace's HTTPS URL: the URL itself, on one line. */
const cloneUrlKept: ScriptedSpawn = {
  commandLine: cloneUrlLine,
  answer: { stdout: "https://github.com/acmelabs-15/marketplace.git\n" },
};

/** fakeWorld's log entry for the read of the clone's URL: no folder, GIT_TERMINAL_PROMPT=0. */
const loggedCloneUrl: WorldCall = {
  kind: "spawn",
  commandLine: cloneUrlLine,
  env: { GIT_TERMINAL_PROMPT: "0" },
};

describe("clone", () => {
  let work: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "acmelabs-clone-"));
    await Bun.write(path.join(work, "a-file"), "here\n");
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test("clones the HTTPS URL into a new folder through gh's login, with GIT_TERMINAL_PROMPT=0", async () => {
    const world = fakeWorld({
      env: { GIT_DIR: "/work/other/.git", GIT_INDEX_FILE: "/work/other/.git/index" },
      spawn: [
        cloneUrlKept,
        { commandLine: cloneLine, answer: { stderr: `Cloning into '${newFolder}'...\n` } },
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into: newFolder },
      caller,
    );
    expect(outcome).toEqual({
      ok: true,
      command: "sample clone",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: { into: newFolder },
    });
    expect(caller.updates).toEqual([cloneStep(newFolder, "started"), cloneStep(newFolder, "done")]);
    // toStrictEqual: the clone and the read of its URL run in no folder of their own, and without
    // the GIT_ variables, so an absolute GIT_INDEX_FILE cannot make the clone write into another
    // repo's index (note 12, 1.4).
    const env = { GIT_DIR: undefined, GIT_INDEX_FILE: undefined, GIT_TERMINAL_PROMPT: "0" };
    expect(world.calls).toStrictEqual([
      { kind: "spawn", commandLine: cloneUrlLine, env },
      { kind: "spawn", commandLine: cloneLine, env },
    ]);
  });

  test.each([
    ["a folder", ""],
    ["a file", "a-file"],
  ])(
    "a path where %s exists ends with exit 2, naming it, and makes no git call",
    async (_case, name) => {
      const into = path.join(work, name);
      const world = fakeWorld();
      const caller = frontEnd(world);
      const outcome = await runCommand(
        cloneCommand,
        { owner: "acmelabs-15", name: "marketplace", into },
        caller,
      );
      expect(outcome).toEqual({
        ok: false,
        command: "sample clone",
        exitCode: 2,
        durationMs: expect.any(Number),
        error: {
          kind: "input",
          message: `${into} already exists; acmelabs clones acmelabs-15/marketplace only into a new folder, so name a folder that does not exist yet`,
          issues: [],
        },
      });
      expect(caller.updates).toEqual([cloneStep(into, "started"), cloneStep(into, "failed")]);
      expect(world.calls).toEqual([]);
    },
  );

  test("an existing folder with control characters shows on one line in the message", async () => {
    // A folder comes from the caller as given, and a terminal shows the message.
    const into = path.join(work, "odd\u001B[2Jfile");
    await Bun.write(into, "here\n");
    const world = fakeWorld();
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: `${work}/odd [2Jfile already exists; acmelabs clones acmelabs-15/marketplace only into a new folder, so name a folder that does not exist yet`,
      },
    });
    expect(world.calls).toEqual([]);
  });

  test("a path under a file, with control characters, shows on one line in the message and in lstat's error", async () => {
    // lstat's error text names the path again.
    const into = path.join(work, "a-file", "odd\u001B[2J");
    const world = fakeWorld();
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into },
      frontEnd(world),
    );
    const shown = `${work}/a-file/odd [2J`;
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: `acmelabs cannot clone acmelabs-15/marketplace into ${shown}: ENOTDIR: not a directory, lstat '${shown}'`,
      },
    });
  });

  test("a path under a file ends with exit 2, naming the path and why, and makes no git call", async () => {
    const into = path.join(work, "a-file", "marketplace");
    const world = fakeWorld();
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: `acmelabs cannot clone acmelabs-15/marketplace into ${into}: ENOTDIR: not a directory, lstat '${into}'`,
      },
    });
    expect(world.calls).toEqual([]);
  });

  test("Repository not found, then the clone, clones after one 3-second wait", async () => {
    const world = fakeWorld({
      spawn: [
        cloneUrlKept,
        { commandLine: cloneLine, answer: gitAnswers.repoNotFound },
        { commandLine: cloneLine },
      ],
    });
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into: newFolder },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { into: newFolder } });
    expect(world.calls).toEqual([
      loggedCloneUrl,
      loggedClone,
      { kind: "sleep", ms: 3000 },
      loggedClone,
    ]);
  });

  test("no gh login ends with exit 4, naming gh auth login", async () => {
    const world = fakeWorld({
      spawn: [cloneUrlKept, { commandLine: cloneLine, answer: gitAnswers.noLogin }],
    });
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into: newFolder },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
      },
    });
  });

  test("a token that GitHub rejects, with GH_TOKEN and GITHUB_TOKEN both set, names both to clear", async () => {
    // gh's helper serves GH_TOKEN's token, and GITHUB_TOKEN's once GH_TOKEN is cleared (note 09,
    // section 1.2).
    const world = fakeWorld({
      env: { GH_TOKEN: "not-a-real-token", GITHUB_TOKEN: "also-not-a-real-token" },
      spawn: [cloneUrlKept, { commandLine: cloneLine, answer: gitAnswers.badToken }],
    });
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into: newFolder },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; replace the token in GH_TOKEN, or clear both GH_TOKEN and GITHUB_TOKEN and run gh auth login, then run the command again",
      },
    });
  });

  test("a folder with control characters shows on one line in the step's title, and git gets the folder as given", async () => {
    // A folder comes from the caller as given, and a terminal shows the step's title.
    const into = "/fake-world/market\r\nplace\u202E";
    const line = [...cloneLine.slice(0, -1), into];
    const world = fakeWorld({ spawn: [cloneUrlKept, { commandLine: line }] });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into },
      caller,
    );
    expect(outcome).toMatchObject({ ok: true, result: { into } });
    expect(caller.updates).toEqual([
      cloneStep("/fake-world/market place", "started"),
      cloneStep("/fake-world/market place", "done"),
    ]);
  });

  test("a folder that starts with - stays a folder: it comes after --", async () => {
    const into = "--upload-pack=touch /tmp/x";
    const line = [...cloneLine.slice(0, -1), into];
    const world = fakeWorld({ spawn: [cloneUrlKept, { commandLine: line }] });
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { into } });
  });

  test("a repo name that fails the name check ends with exit 2 before the step starts, and makes no call", async () => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "..", into: newFolder },
      caller,
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: { kind: "input", message: '"acmelabs-15/.." is not a GitHub repo' },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("a folder with no name ends with exit 2 before the step starts, and makes no call", async () => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into: "" },
      caller,
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: "the folder to clone acmelabs-15/marketplace into has no name",
      },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });
});

/**
 * The message for a rewrite of acmelabs-15/<name>'s HTTPS URL to `shown`, the URL that a clone
 * would use.
 */
function cloneRewritten(name: string, shown: string): string {
  const repo = `acmelabs-15/${name}`;
  return `git's config rewrites the URL of ${repo}, https://github.com/${repo}.git, to ${shown}; acmelabs clones ${repo} only from that HTTPS URL, with gh's login, so remove the rewrite (git config --show-origin --get-regexp '^url\\.' lists each one)`;
}

describe("clone: a rewrite in git's config", () => {
  // A clone reads the global and the system git config, and `url.<base>.insteadOf` there moves
  // its URL (probes on git 2.54.0, note 09, section 4).
  test.each([
    [
      "moves the URL to another host",
      "https://evil.example/acmelabs-15/marketplace.git\n",
      "https://evil.example/acmelabs-15/marketplace.git",
    ],
    [
      "gives the SSH form, which would skip gh's login",
      "git@github.com:acmelabs-15/marketplace.git\n",
      "git@github.com:acmelabs-15/marketplace.git",
    ],
    [
      "gives a URL with a login part, which the message leaves out",
      "https://x-access-token:ghp_secret0@evil.example/acmelabs-15/marketplace.git\n",
      "https://evil.example/acmelabs-15/marketplace.git",
    ],
  ])(
    "a rewrite that %s ends with exit 2, naming the URL that git would use, and clones nothing",
    async (_case, stdout, shown) => {
      const world = fakeWorld({ spawn: [{ commandLine: cloneUrlLine, answer: { stdout } }] });
      const caller = frontEnd(world);
      const outcome = await runCommand(
        cloneCommand,
        { owner: "acmelabs-15", name: "marketplace", into: newFolder },
        caller,
      );
      expect(JSON.stringify(outcome)).not.toContain("ghp_secret0");
      expect(outcome).toEqual({
        ok: false,
        command: "sample clone",
        exitCode: 2,
        durationMs: expect.any(Number),
        error: { kind: "input", message: cloneRewritten("marketplace", shown), issues: [] },
      });
      expect(caller.updates).toEqual([
        cloneStep(newFolder, "started"),
        cloneStep(newFolder, "failed"),
      ]);
      expect(world.calls).toEqual([loggedCloneUrl]);
    },
  );

  test("a read of the clone's URL that fails ends with exit 3, naming the call and git's message", async () => {
    const world = fakeWorld({
      spawn: [
        {
          commandLine: cloneUrlLine,
          answer: {
            code: 128,
            stderr: "fatal: bad config line 1 in file /Users/test/.gitconfig\n",
          },
        },
      ],
    });
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "marketplace", into: newFolder },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "git --git-dir=/dev/null ls-remote --get-url https://github.com/acmelabs-15/marketplace.git failed with exit 128: fatal: bad config line 1 in file /Users/test/.gitconfig",
      },
    });
    expect(world.calls).toEqual([loggedCloneUrl]);
  });
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
function setupGit(folder: string, ...words: string[]): string {
  const spawned = Bun.spawnSync(["git", "-C", folder, ...words], {
    env: { ...withoutGitVariables(), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (spawned.exitCode !== 0) {
    throw new Error(`git ${words.join(" ")} failed: ${spawned.stderr.toString()}`);
  }
  return spawned.stdout.toString().trim();
}

/** Makes an empty commit in the repo at `folder`, and gives its sha. */
function commit(folder: string, message: string): string {
  setupGit(
    folder,
    "-c",
    "user.name=ACMElabs Test",
    "-c",
    "user.email=test@acmelabs.invalid",
    "commit",
    "--allow-empty",
    `--message=${message}`,
  );
  return setupGit(folder, "rev-parse", "HEAD");
}

/**
 * Makes a repo at `folder` with one commit on main, and pushes main to the bare repo `bare`.
 * It gives the commit's sha.
 */
function seed(folder: string, bare: string): string {
  setupGit(path.dirname(folder), "init", "--quiet", "--initial-branch=main", folder);
  const sha = commit(folder, "theirs");
  setupGit(folder, "push", "--quiet", bare, "main");
  return sha;
}

describe("push and clone: real git, with a local bare repo in place of GitHub", () => {
  /** A temp folder that holds the bare repos, the home folder and the local repos. */
  let temp: string;
  /** A real World whose home folder's git config sends each repo's HTTPS URL to its bare repo. */
  let rewriting: World;
  /**
   * The same World, except that the steps' reads of the URLs that git uses (`git remote get-url`
   * and `git ls-remote --get-url`) run with an empty home folder. The steps refuse the home
   * folder's rewrites, so those reads give what a machine with no rewrite gives, while
   * `git ls-remote`, `git push` and `git clone` still reach the bare repo.
   */
  let world: World;
  /** The repos, one for each test, each with a bare repo that stands in for it on GitHub. */
  const names = [
    "probe-push",
    "probe-rejected",
    "probe-clone",
    "probe-clone-local",
    "probe-clone-refused",
  ] as const;

  /** The bare repo that stands in for acmelabs-15/<name> on GitHub. */
  function bare(name: (typeof names)[number]): string {
    return path.join(temp, `${name}.git`);
  }

  beforeAll(async () => {
    temp = await mkdtemp(path.join(tmpdir(), "acmelabs-push-"));
    const home = path.join(temp, "home");
    const rules = names.map(
      (name) => `[url "${bare(name)}"]\n\tinsteadOf = https://github.com/acmelabs-15/${name}.git\n`,
    );
    await Bun.write(path.join(home, ".gitconfig"), rules.join(""));
    for (const name of names) {
      setupGit(temp, "init", "--quiet", "--bare", "--initial-branch=main", bare(name));
    }
    const emptyHome = path.join(temp, "empty-home");
    await mkdir(emptyHome);
    // The World has its own env, so the test sets no variable in the test process.
    rewriting = realWorld({ env: { ...Bun.env, HOME: home, XDG_CONFIG_HOME: home } });
    world = {
      ...rewriting,
      spawn(commandLine, options = {}) {
        if (!commandLine.includes("get-url") && !commandLine.includes("--get-url")) {
          return rewriting.spawn(commandLine, options);
        }
        const env = { ...options.env, HOME: emptyHome, XDG_CONFIG_HOME: emptyHome };
        return rewriting.spawn(commandLine, { ...options, env });
      },
    };
  });

  afterAll(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test("a first push adds origin, pushes and sets the upstream; a second push is skipped", async () => {
    const work = path.join(temp, "push-work");
    setupGit(temp, "init", "--quiet", "--initial-branch=main", work);
    const sha = commit(work, "first");
    const request = { owner: "acmelabs-15", name: "probe-push", cwd: work, branch: "main" };

    const first = await runCommand(pushCommand, request, frontEnd(world));
    expect(first).toMatchObject({ ok: true, result: { sha, pushed: true } });
    expect(setupGit(bare("probe-push"), "rev-parse", "refs/heads/main")).toBe(sha);
    expect(setupGit(work, "config", "--get", "remote.origin.url")).toBe(
      "https://github.com/acmelabs-15/probe-push.git",
    );
    expect(setupGit(work, "config", "--get", "branch.main.merge")).toBe("refs/heads/main");

    const caller = frontEnd(world);
    const second = await runCommand(pushCommand, request, caller);
    expect(second).toMatchObject({ ok: true, result: { sha, pushed: false } });
    expect(caller.updates.at(-1)).toMatchObject({ status: "skipped", detail: `already at ${sha}` });
  });

  test("a push behind GitHub's branch ends with exit 1 and git's message, and GitHub's branch stays", async () => {
    const theirs = seed(path.join(temp, "rejected-theirs"), bare("probe-rejected"));
    const work = path.join(temp, "rejected-work");
    setupGit(temp, "init", "--quiet", "--initial-branch=main", work);
    commit(work, "ours");

    const outcome = await runCommand(
      pushCommand,
      { owner: "acmelabs-15", name: "probe-rejected", cwd: work, branch: "main" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 1,
      error: { kind: "problem", message: expect.stringContaining("! [rejected]") },
    });
    expect(setupGit(bare("probe-rejected"), "rev-parse", "refs/heads/main")).toBe(theirs);
  });

  test("a rewrite in the local repo's git config ends with exit 2, and the push reaches no repo", async () => {
    // The local config sends every github.com URL to a folder, as it could send it to any host.
    const elsewhere = path.join(temp, "elsewhere");
    const target = path.join(elsewhere, "acmelabs-15", "probe-rewrite.git");
    setupGit(temp, "init", "--quiet", "--bare", "--initial-branch=main", target);
    const work = path.join(temp, "rewrite-work");
    setupGit(temp, "init", "--quiet", "--initial-branch=main", work);
    commit(work, "mine");
    setupGit(work, "config", `url.${elsewhere}/.insteadOf`, "https://github.com/");

    const outcome = await runCommand(
      pushCommand,
      { owner: "acmelabs-15", name: "probe-rewrite", cwd: work, branch: "main" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message: `git's config rewrites the remote origin of ${work}, https://github.com/acmelabs-15/probe-rewrite.git, to ${target}; acmelabs pushes acmelabs-15/probe-rewrite only to that HTTPS URL, with gh's login, so remove the rewrite (git config --show-origin --get-regexp '^url\\.' lists each one)`,
      },
    });
    // The step stops before git ls-remote and git push: the rewrite's repo gets no branch.
    expect(setupGit(target, "for-each-ref")).toBe("");
  });

  test("clone clones the HTTPS URL into a new folder", async () => {
    const theirs = seed(path.join(temp, "clone-theirs"), bare("probe-clone"));
    const into = path.join(temp, "clone-copy");
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "probe-clone", into },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { into } });
    expect(setupGit(into, "rev-parse", "HEAD")).toBe(theirs);
    expect(setupGit(into, "config", "--get", "remote.origin.url")).toBe(
      "https://github.com/acmelabs-15/probe-clone.git",
    );
  });

  test("a rewrite in the home folder's git config ends with exit 2, and makes no folder", async () => {
    // The World with the home folder's rewrites in every call: a clone would go to the bare repo.
    seed(path.join(temp, "refused-theirs"), bare("probe-clone-refused"));
    const into = path.join(temp, "refused-copy");
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "probe-clone-refused", into },
      frontEnd(rewriting),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message: cloneRewritten("probe-clone-refused", bare("probe-clone-refused")),
      },
    });
    await expect(lstat(into)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("a rewrite in the config of a repo around the working folder, which a clone does not read, does not stop the clone", async () => {
    // The local repo's config sends every github.com URL to a folder. A clone that runs inside the
    // repo does not read it, and neither does the step's read of the clone's URL (probe).
    const around = path.join(temp, "around");
    setupGit(temp, "init", "--quiet", "--initial-branch=main", around);
    setupGit(
      around,
      "config",
      `url.${path.join(temp, "elsewhere-local")}/.insteadOf`,
      "https://github.com/",
    );
    const theirs = seed(path.join(temp, "local-theirs"), bare("probe-clone-local"));
    const inside: World = {
      ...world,
      spawn: (commandLine, options = {}) =>
        world.spawn(commandLine, { ...options, cwd: options.cwd ?? around }),
    };
    const into = path.join(temp, "local-copy");
    const outcome = await runCommand(
      cloneCommand,
      { owner: "acmelabs-15", name: "probe-clone-local", into },
      frontEnd(inside),
    );
    expect(outcome).toMatchObject({ ok: true, result: { into } });
    expect(setupGit(into, "rev-parse", "HEAD")).toBe(theirs);
  });
});
