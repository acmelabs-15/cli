import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { ProgressUpdate } from "../../command/command";
import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { Spawned } from "../../command/world";
import { ensureRepo } from "../repo";
import {
  frontEnd,
  ghAnswers,
  ghLogged,
  ghLoggedEveryTry,
  ghScripted,
  ghScriptedEveryTry,
} from "./gh-answers";

/** A sample command that creates a GitHub repo, or reuses it when it is this run's repo. */
const repoCommand = defineCommand({
  path: ["sample", "repo"],
  summary: "Create a GitHub repo, or reuse it when it is this run's repo.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
    visibility: z.enum(["public", "private"]).describe("The repo's visibility."),
    description: z.string().optional().describe("The repo's description."),
    localRoot: z.string().describe("The folder of the local git repo."),
  }),
  run(input, context) {
    const { owner, name, ...request } = input;
    return ensureRepo(context, { repo: { owner, name }, ...request });
  },
});

/** The repo's step for a repo, with one status. */
function repoStep(
  repo: string,
  status: "started" | "done" | "failed" | "skipped",
  detail?: string,
): ProgressUpdate {
  const step = {
    kind: "step",
    step: "github-repo",
    title: `Create the GitHub repo ${repo}`,
    status,
  } as const;
  return detail === undefined ? step : { ...step, detail };
}

/** The local git repo of every sample run. */
const localRoot = "/work/cli";

/**
 * The calls of the repo's step for a repo: the read of the repo, the create in its organization
 * with a body as gh reads it on stdin, and the read of its main branch.
 */
function repoCalls(owner: string, name: string, createStdin = "") {
  return {
    read: { path: `repos/${owner}/${name}` },
    create: { method: "POST", path: `orgs/${owner}/repos`, stdin: createStdin },
    main: { path: `repos/${owner}/${name}/git/ref/heads/main` },
  } as const;
}

/**
 * gh's answers to reads of acmelabs-15's repos. Each one is real, read on 2026-10-20 under API
 * version 2026-03-10 with the spec's two headers, and trimmed to its first fields of text, numbers
 * and booleans.
 */
const repoAnswers = {
  /** acmelabs-15/cli: public, with commits on main. A create answers in the same shape (201). */
  cli: {
    code: 0,
    stdout:
      '{"id":1426700214,"node_id":"R_kgDOVQm3tg","name":"cli","full_name":"acmelabs-15/cli","private":false,"html_url":"https://github.com/acmelabs-15/cli","description":"The ACMElabs CLI: one tool that makes ACMElabs repos start in shape and keeps them there. Pure Bun.","fork":false,"url":"https://api.github.com/repos/acmelabs-15/cli","created_at":"2026-10-20T08:09:08Z","updated_at":"2026-10-20T15:05:36Z","pushed_at":"2026-10-20T18:56:55Z","ssh_url":"git@github.com:acmelabs-15/cli.git","clone_url":"https://github.com/acmelabs-15/cli.git","size":831,"visibility":"public","default_branch":"main"}',
    stderr: "",
  },
  /** acmelabs-15/pinky: private, created on 2026-05-28 and never pushed, so empty. */
  pinky: {
    code: 0,
    stdout:
      '{"id":1252122978,"node_id":"R_kgDOSqHhYg","name":"pinky","full_name":"acmelabs-15/pinky","private":true,"html_url":"https://github.com/acmelabs-15/pinky","description":null,"fork":false,"url":"https://api.github.com/repos/acmelabs-15/pinky","created_at":"2026-05-28T07:58:40Z","updated_at":"2026-05-28T07:58:40Z","pushed_at":"2026-05-28T07:58:40Z","ssh_url":"git@github.com:acmelabs-15/pinky.git","clone_url":"https://github.com/acmelabs-15/pinky.git","size":0,"visibility":"private","default_branch":"main"}',
    stderr: "",
  },
  /** acmelabs-15/cli's main branch, at bb0c949. */
  cliMain: {
    code: 0,
    stdout:
      '{"ref":"refs/heads/main","node_id":"REF_kwDOVQm3tq9yZWZzL2hlYWRzL21haW4","url":"https://api.github.com/repos/acmelabs-15/cli/git/refs/heads/main","object":{"sha":"bb0c949064ca21a2a00beff42fea6d4c2d24c27e","type":"commit","url":"https://api.github.com/repos/acmelabs-15/cli/git/commits/bb0c949064ca21a2a00beff42fea6d4c2d24c27e"}}',
    stderr: "",
  },
  /** No repo of that name: `repos/acmelabs-no-such-org-4f2b9c/cli`. */
  noRepo: {
    code: 1,
    stdout:
      '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"}',
    stderr: "gh: Not Found (HTTP 404)\n",
  },
} satisfies Record<string, Spawned>;

/** Built: cli's answer with some fields changed. A field set to undefined is left out. */
function cliWith(fields: Record<string, unknown>): Spawned {
  const repo: object = JSON.parse(repoAnswers.cli.stdout);
  return { code: 0, stdout: JSON.stringify({ ...repo, ...fields }), stderr: "" };
}

/** Built: GitHub's answer to a create, a 201 with the new repo: cli's answer with its names. */
function createdRepo(name: string, visibility: "public" | "private"): Spawned {
  return cliWith({
    name,
    full_name: `acmelabs-15/${name}`,
    private: visibility === "private",
    html_url: `https://github.com/acmelabs-15/${name}`,
    clone_url: `https://github.com/acmelabs-15/${name}.git`,
    visibility,
  });
}

/** The commit of cli's main branch in `repoAnswers.cliMain`. */
const cliMainSha = "bb0c949064ca21a2a00beff42fea6d4c2d24c27e";

/**
 * The local-history check of cli's main commit, as git's command line in the local repo. The fake
 * World's env holds no GIT_ variable, so the call only adds GIT_TERMINAL_PROMPT=0 (ADR-0016).
 */
const cliMainCheck = {
  commandLine: ["git", "merge-base", "--is-ancestor", cliMainSha, "HEAD"],
  cwd: localRoot,
  env: { GIT_TERMINAL_PROMPT: "0" },
} as const;

/** git's answer to the local-history check: exit 0 for yes, 1 for no, 128 for an unknown commit. */
function gitAnswer(code: number): { commandLine: readonly string[]; answer: Spawned } {
  const stderr = code === 128 ? `fatal: Not a valid commit name ${cliMainSha}\n` : "";
  return { commandLine: cliMainCheck.commandLine, answer: { code, stdout: "", stderr } };
}

describe("ensureRepo: a new repo", () => {
  test("a 404 gives a POST with the name, the description and the visibility, and a done step", async () => {
    const calls = repoCalls(
      "acmelabs-15",
      "jev",
      '{"name":"jev","description":"Jev\'s gate.","visibility":"private"}',
    );
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.noRepo),
        ghScripted(calls.create, createdRepo("jev", "private")),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      {
        owner: "acmelabs-15",
        name: "jev",
        visibility: "private",
        description: "Jev's gate.",
        localRoot,
      },
      caller,
    );
    expect(outcome).toEqual({
      ok: true,
      command: "sample repo",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: {
        url: "https://github.com/acmelabs-15/jev",
        cloneUrl: "https://github.com/acmelabs-15/jev.git",
        made: "created",
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-15/jev", "started"),
      repoStep("acmelabs-15/jev", "done"),
    ]);
    expect(world.calls).toEqual([ghLogged(calls.read), ghLogged(calls.create)]);
  });

  test("with no description, the POST leaves it out, so GitHub's default holds", async () => {
    const calls = repoCalls("acmelabs-15", "jev", '{"name":"jev","visibility":"public"}');
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.noRepo),
        ghScripted(calls.create, createdRepo("jev", "public")),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "jev", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { made: "created" } });
    expect(world.calls).toEqual([ghLogged(calls.read), ghLogged(calls.create)]);
  });
});

describe("ensureRepo: an existing repo that is this run's repo", () => {
  test("an empty repo gives a skipped step, the reads only, and no write", async () => {
    const calls = repoCalls("acmelabs-15", "pinky");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.pinky),
        ghScripted(calls.main, ghAnswers.repositoryEmpty),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "pinky", visibility: "private", localRoot },
      caller,
    );
    expect(outcome).toEqual({
      ok: true,
      command: "sample repo",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: {
        url: "https://github.com/acmelabs-15/pinky",
        cloneUrl: "https://github.com/acmelabs-15/pinky.git",
        made: "reused",
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-15/pinky", "started"),
      repoStep("acmelabs-15/pinky", "skipped", "already there, and empty"),
    ]);
    expect(world.calls).toEqual([ghLogged(calls.read), ghLogged(calls.main)]);
  });

  test("a repo whose main commit is in the local history gives a skipped step, and no write", async () => {
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.cli),
        ghScripted(calls.main, repoAnswers.cliMain),
        gitAnswer(0),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      caller,
    );
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        url: "https://github.com/acmelabs-15/cli",
        cloneUrl: "https://github.com/acmelabs-15/cli.git",
        made: "reused",
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-15/cli", "started"),
      repoStep("acmelabs-15/cli", "skipped", "already there, at a commit in the local history"),
    ]);
    expect(world.calls).toEqual([
      ghLogged(calls.read),
      ghLogged(calls.main),
      { kind: "spawn", ...cliMainCheck },
    ]);
  });

  test("the default branch goes into the ref's path encoded", async () => {
    const read = { path: "repos/acmelabs-15/cli" };
    const ref = { path: "repos/acmelabs-15/cli/git/ref/heads/release%2F2026%231" };
    const world = fakeWorld({
      spawn: [
        ghScripted(read, cliWith({ default_branch: "release/2026#1" })),
        ghScripted(ref, repoAnswers.cliMain),
        gitAnswer(0),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { made: "reused" } });
    expect(world.calls).toEqual([
      ghLogged(read),
      ghLogged(ref),
      { kind: "spawn", ...cliMainCheck },
    ]);
  });

  test("a 404, then the branch, on the main branch's read reuses the repo after one 3-second wait", async () => {
    // A re-run moments after a run that created the repo: GitHub can answer 404 for a few seconds.
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.cli),
        ghScripted(calls.main, ghAnswers.notFound),
        ghScripted(calls.main, repoAnswers.cliMain),
        gitAnswer(0),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { made: "reused" } });
    expect(world.calls).toEqual([
      ghLogged(calls.read),
      ghLogged(calls.main),
      { kind: "sleep", ms: 3000 },
      ghLogged(calls.main),
      { kind: "spawn", ...cliMainCheck },
    ]);
  });
});

describe("ensureRepo: an existing repo that is not this run's repo", () => {
  test.each([
    ["exit 1, a commit outside the local history", 1],
    ["exit 128, a commit that the local repo does not know", 128],
  ])(
    "a main commit for which git gives %s, ends with exit 2, naming the repo, and makes no write",
    async (_case, code) => {
      const calls = repoCalls("acmelabs-15", "cli");
      const world = fakeWorld({
        spawn: [
          ghScripted(calls.read, repoAnswers.cli),
          ghScripted(calls.main, repoAnswers.cliMain),
          gitAnswer(code),
        ],
      });
      const caller = frontEnd(world);
      const outcome = await runCommand(
        repoCommand,
        { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
        caller,
      );
      expect(outcome).toEqual({
        ok: false,
        command: "sample repo",
        exitCode: 2,
        durationMs: expect.any(Number),
        error: {
          kind: "input",
          message:
            "acmelabs-15/cli already exists on GitHub and holds other work: its main branch is at bb0c949064ca21a2a00beff42fea6d4c2d24c27e, a commit that is not in the local history of /work/cli; acmelabs changes nothing in acmelabs-15/cli, so pick another name",
          issues: [],
        },
      });
      expect(caller.updates).toEqual([
        repoStep("acmelabs-15/cli", "started"),
        repoStep("acmelabs-15/cli", "failed"),
      ]);
      expect(world.calls).toEqual([
        ghLogged(calls.read),
        ghLogged(calls.main),
        { kind: "spawn", ...cliMainCheck },
      ]);
    },
  );

  test("GitHub's default branch and the local folder show on one line in the message", async () => {
    // Built: the default branch comes from GitHub, and the local folder from the caller as given.
    const read = { path: "repos/acmelabs-15/cli" };
    const ref = { path: "repos/acmelabs-15/cli/git/ref/heads/ma%1B%5B2Jin" };
    const world = fakeWorld({
      spawn: [
        ghScripted(read, cliWith({ default_branch: "ma\u001B[2Jin" })),
        ghScripted(ref, repoAnswers.cliMain),
        gitAnswer(1),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot: "/work/cli\r\n" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "acmelabs-15/cli already exists on GitHub and holds other work: its ma [2Jin branch is at bb0c949064ca21a2a00beff42fea6d4c2d24c27e, a commit that is not in the local history of /work/cli; acmelabs changes nothing in acmelabs-15/cli, so pick another name",
      },
    });
  });

  test("a public repo, asked for as private, ends with exit 2, naming both visibilities, and makes no write", async () => {
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({ spawn: [ghScripted(calls.read, repoAnswers.cli)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "private", localRoot },
      caller,
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample repo",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          "acmelabs-15/cli already exists on GitHub as a public repo, and this run asks for a private one; acmelabs never changes a repo's visibility, and changes nothing in acmelabs-15/cli, so pick another name, or ask for a public repo",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-15/cli", "started"),
      repoStep("acmelabs-15/cli", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(calls.read)]);
  });

  test("GitHub's visibility shows on one line in the message", async () => {
    // Built: GitHub's text reaches a terminal in the message, so it follows the text rule.
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [ghScripted(calls.read, cliWith({ visibility: "inter\u001B[2Jnal" }))],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "acmelabs-15/cli already exists on GitHub as a inter [2Jnal repo, and this run asks for a public one; acmelabs never changes a repo's visibility, and changes nothing in acmelabs-15/cli, so pick another name, or ask for a inter [2Jnal repo",
      },
    });
  });

  test("an empty private repo, asked for as public, ends with exit 2 before its branch is read", async () => {
    const calls = repoCalls("acmelabs-15", "pinky");
    const world = fakeWorld({ spawn: [ghScripted(calls.read, repoAnswers.pinky)] });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "pinky", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "acmelabs-15/pinky already exists on GitHub as a private repo, and this run asks for a public one; acmelabs never changes a repo's visibility, and changes nothing in acmelabs-15/pinky, so pick another name, or ask for a private repo",
      },
    });
    expect(world.calls).toEqual([ghLogged(calls.read)]);
  });

  test("a main branch that stays 404 after every try ends with exit 2, naming the repo, and makes no write", async () => {
    // GitHub answers 409 for every ref of an empty repo, so a 404 means a repo with other work.
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.cli),
        ...ghScriptedEveryTry(calls.main, ghAnswers.notFound),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      caller,
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "acmelabs-15/cli already exists on GitHub and holds other work: it is not empty, and GitHub finds no main branch in it; acmelabs changes nothing in acmelabs-15/cli, so pick another name",
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-15/cli", "started"),
      repoStep("acmelabs-15/cli", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(calls.read), ...ghLoggedEveryTry(calls.main)]);
  });

  test("a 409 on the main branch other than an empty repo ends with exit 3, and makes no write", async () => {
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.cli),
        // Built: a 409 whose message is not GitHub's "Git Repository is empty."
        ghScripted(calls.main, {
          code: 1,
          stdout:
            '{"message":"Conflict","documentation_url":"https://docs.github.com/rest/git/refs#get-a-reference","status":"409"}',
          stderr: "gh: Conflict (HTTP 409)\n",
        }),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub answered GET repos/acmelabs-15/cli/git/ref/heads/main with HTTP 409: Conflict",
      },
    });
    expect(world.calls).toEqual([ghLogged(calls.read), ghLogged(calls.main)]);
  });
});

describe("ensureRepo: GitHub refuses the create", () => {
  test("an unknown owner, a 404 on the read and on the POST, ends with exit 2, naming the owner and the repo", async () => {
    const calls = repoCalls(
      "acmelabs-no-such-org-4f2b9c",
      "cli",
      '{"name":"cli","visibility":"public"}',
    );
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.noRepo),
        // Built: GitHub answers 404 to a create in an organization that it does not find for the
        // login, as it answers a read of a resource it hides (note 09, section 2.9).
        ghScripted(calls.create, {
          code: 1,
          stdout:
            '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#create-an-organization-repository","status":"404"}',
          stderr: "gh: Not Found (HTTP 404)\n",
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-no-such-org-4f2b9c", name: "cli", visibility: "public", localRoot },
      caller,
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample repo",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          "GitHub found no organization acmelabs-no-such-org-4f2b9c in which the gh login may create acmelabs-no-such-org-4f2b9c/cli (HTTP 404 on POST orgs/acmelabs-no-such-org-4f2b9c/repos); check the owner, and that the login is a member of the organization",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-no-such-org-4f2b9c/cli", "started"),
      repoStep("acmelabs-no-such-org-4f2b9c/cli", "failed"),
    ]);
    // A POST is never sent twice: GitHub may have applied it.
    expect(world.calls).toEqual([ghLogged(calls.read), ghLogged(calls.create)]);
  });

  test('a 422 "name already exists" ends with exit 2, naming the repo and the gh login', async () => {
    // Another run or a person made the repo between the read and the create.
    const calls = repoCalls("acmelabs-15", "jev", '{"name":"jev","visibility":"public"}');
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.noRepo),
        // Built: the body that note 09 reports for a name taken (section 2.3), with the
        // documentation_url and the status that GitHub's error bodies carry today (section 1.2).
        ghScripted(calls.create, {
          code: 1,
          stdout:
            '{"message":"Repository creation failed.","errors":[{"resource":"Repository","code":"custom","field":"name","message":"name already exists on this account"}],"documentation_url":"https://docs.github.com/rest/repos/repos#create-an-organization-repository","status":"422"}',
          stderr: "gh: Repository creation failed. (HTTP 422)\n",
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "jev", visibility: "public", localRoot },
      caller,
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample repo",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          "GitHub refused POST orgs/acmelabs-15/repos for the gh login: a repo named acmelabs-15/jev already exists, made a moment ago by another run or a person, or hidden from the login (HTTP 422); run the command again, or pick another name",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-15/jev", "started"),
      repoStep("acmelabs-15/jev", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(calls.read), ghLogged(calls.create)]);
  });

  test("a 422 for another reason ends with exit 3, as the table's other answers", async () => {
    const calls = repoCalls("acmelabs-15", "jev", '{"name":"jev","visibility":"public"}');
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.noRepo),
        // Built: a 422 whose error is not a name taken.
        ghScripted(calls.create, {
          code: 1,
          stdout:
            '{"message":"Repository creation failed.","errors":[{"resource":"Repository","code":"invalid","field":"visibility","message":"visibility is invalid"}],"status":"422"}',
          stderr: "gh: Repository creation failed. (HTTP 422)\n",
        }),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "jev", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub answered POST orgs/acmelabs-15/repos with HTTP 422: Repository creation failed. (visibility is invalid)",
      },
    });
  });

  test("a 404 on the read for which gh names a missing scope ends with exit 4, and makes no POST", async () => {
    // Built: a token without repo gets 404 for a private repo, and the endpoint checks repo.
    const calls = repoCalls("acmelabs-15", "pinky");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, {
          ...repoAnswers.noRepo,
          stderr: `${repoAnswers.noRepo.stderr}gh: This API operation needs the "repo" scope. To request it, run:  gh auth refresh -h github.com -s repo\n`,
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "pinky", visibility: "private", localRoot },
      caller,
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s repo, then run the command again",
      },
    });
    expect(caller.updates).toEqual([
      repoStep("acmelabs-15/pinky", "started"),
      repoStep("acmelabs-15/pinky", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(calls.read)]);
  });
});

describe("ensureRepo: answers the step cannot use", () => {
  test("a repo answer of another shape ends with exit 3, naming the call, and makes no write", async () => {
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [ghScripted(calls.read, cliWith({ visibility: undefined }))],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/cli gave an answer that acmelabs cannot read: visibility: Invalid input: expected string, received undefined",
      },
    });
    expect(world.calls).toEqual([ghLogged(calls.read)]);
  });

  test("a default branch with a lone surrogate ends with exit 3, and goes into no path", async () => {
    // Built: JSON can carry one half of a UTF-16 pair, which encodeURIComponent cannot encode.
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [ghScripted(calls.read, cliWith({ default_branch: "ma\uD800in" }))],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message: String.raw`gh api GET repos/acmelabs-15/cli gave an answer that acmelabs cannot read: default_branch: "ma\ud800in" holds a lone surrogate, one half of a UTF-16 pair, which a URL cannot encode`,
      },
    });
    expect(world.calls).toEqual([ghLogged(calls.read)]);
  });

  test("a main commit that is not a full sha ends with exit 3, and goes into no git command line", async () => {
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.cli),
        ghScripted(calls.main, {
          code: 0,
          stdout: '{"ref":"refs/heads/main","object":{"sha":"--output=/tmp/x","type":"commit"}}',
          stderr: "",
        }),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          'gh api GET repos/acmelabs-15/cli/git/ref/heads/main gave an answer that acmelabs cannot read: object.sha: "--output=/tmp/x" is not a commit sha; a sha is 40 characters, each 0 to 9 or a to f',
      },
    });
    expect(world.calls).toEqual([ghLogged(calls.read), ghLogged(calls.main)]);
  });

  test("GitHub's sha that the check refuses shows a bidi mark and a C1 control as escapes", async () => {
    // Built: the check quotes GitHub's sha, and JSON.stringify alone leaves U+202E and U+009B raw.
    const calls = repoCalls("acmelabs-15", "cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(calls.read, repoAnswers.cli),
        ghScripted(calls.main, {
          code: 0,
          stdout: String.raw`{"ref":"refs/heads/main","object":{"sha":"bb0c\u202e\u009bminim","type":"commit"}}`,
          stderr: "",
        }),
      ],
    });
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    const wrong = String.raw`"bb0c\u202e\u009bminim" is not a commit sha; a sha is 40 characters, each 0 to 9 or a to f`;
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message: `gh api GET repos/acmelabs-15/cli/git/ref/heads/main gave an answer that acmelabs cannot read: object.sha: ${wrong}`,
        issues: [{ field: "object.sha", message: wrong }],
      },
    });
  });

  test("a repo name that fails the name check ends with exit 2 before the step starts, and makes no call", async () => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15", name: "../user", visibility: "public", localRoot },
      caller,
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: { kind: "input", message: '"acmelabs-15/../user" is not a GitHub repo' },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("an owner that fails the name check ends with exit 2, and goes into no create path", async () => {
    const world = fakeWorld();
    const outcome = await runCommand(
      repoCommand,
      { owner: "acmelabs-15/repos?x=", name: "cli", visibility: "public", localRoot },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: { kind: "input", issues: [{ field: "owner" }] },
    });
    expect(world.calls).toEqual([]);
  });
});
