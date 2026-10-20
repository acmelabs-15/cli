import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { ProgressUpdate } from "../../command/command";
import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { Spawned } from "../../command/world";
import { openPullRequest } from "../pull-request";
import { frontEnd, ghAnswers, ghLogged, ghScripted } from "./gh-answers";

/** A sample command that opens a pull request on a GitHub repo, or reuses the open one. */
const pullRequestCommand = defineCommand({
  path: ["sample", "pull-request"],
  summary: "Open a pull request on a GitHub repo, or reuse the open one.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
    head: z.string().describe("The branch with the changes."),
    base: z.string().describe("The branch that the changes go into."),
    title: z.string().describe("The pull request's title."),
    body: z.string().describe("The pull request's description."),
  }),
  run(input, context) {
    const { owner, name, ...pullRequest } = input;
    return openPullRequest(context, { repo: { owner, name }, ...pullRequest });
  },
});

/** The input of a pull request from add-brain into main on acmelabs-15/marketplace. */
const addBrain = {
  owner: "acmelabs-15",
  name: "marketplace",
  head: "add-brain",
  base: "main",
  title: "Add brain",
  body: "Adds brain to the marketplace.\n\nclaude plugin validate . --strict passes.",
} as const;

/** The pull request's step for a head and a base on acmelabs-15/marketplace, with one status. */
function pullStep(
  head: string,
  status: "started" | "done" | "failed" | "skipped",
  detail?: string,
): ProgressUpdate {
  const step = {
    kind: "step",
    step: "github-pull-request",
    title: `Open a pull request from ${head} into main on acmelabs-15/marketplace`,
    status,
  } as const;
  return detail === undefined ? step : { ...step, detail };
}

/** The list of the open PRs from add-brain into main on acmelabs-15/marketplace. */
const listAddBrain = {
  path: "repos/acmelabs-15/marketplace/pulls?head=acmelabs-15%3Aadd-brain&base=main&state=open&per_page=100",
} as const;

/** The POST that opens addBrain's pull request; its body as gh reads it on stdin. */
const createAddBrain = {
  method: "POST",
  path: "repos/acmelabs-15/marketplace/pulls",
  stdin:
    '{"title":"Add brain","head":"add-brain","base":"main","body":"Adds brain to the marketplace.\\n\\nclaude plugin validate . --strict passes."}',
} as const;

/** The repo of every pull request in these tests. */
const marketplace = "acmelabs-15/marketplace";

/** What a test gives a listed pull request: its number, its branches and its head repo. */
type ListedFields = {
  number: number;
  head: string;
  base?: string;
  /** The head's repo, or null for a head repo that is gone, as GitHub gives a deleted fork. */
  headRepo?: string | null;
};

/**
 * Built from a real answer: acmelabs-15/brain's PR #6, as GitHub listed it on 2026-10-20 under
 * API version 2026-03-10, trimmed to the fields around the ones the step reads. The number, the
 * branches and the head repo are the test's, and the state is open.
 */
function listedPullRequest(fields: ListedFields) {
  const { number, head, base = "main", headRepo = marketplace } = fields;
  return {
    url: `https://api.github.com/repos/${marketplace}/pulls/${number}`,
    id: 4_932_033_818,
    node_id: "PR_kwDORgonY88AAAABJfjdGg",
    html_url: `https://github.com/${marketplace}/pull/${number}`,
    number,
    state: "open",
    title: "ci: Version Packages",
    head: {
      ref: head,
      sha: "0a6b012f43a9535064ab65f35e82dc262cacaa07",
      repo: headRepo === null ? null : { full_name: headRepo },
    },
    base: {
      ref: base,
      sha: "dcf9e56607d290c702d525a7d593929aca681d9d",
      repo: { full_name: marketplace },
    },
    draft: false,
  };
}

/** gh's answer to the list: the listed pull requests as GitHub's JSON. */
function listAnswer(...listed: readonly ListedFields[]): Spawned {
  return { code: 0, stdout: JSON.stringify(listed.map(listedPullRequest)), stderr: "" };
}

/**
 * gh's answer to the list when no pull request is open: brain's real answer to the list from
 * acmelabs-15:changeset-release/main into main, read on 2026-10-20 under API version 2026-03-10.
 */
const noOpenPullRequests: Spawned = { code: 0, stdout: "[]", stderr: "" };

/** gh's answer to the POST: 201, the new pull request, in the list's shape (built, as above). */
function createdAnswer(number: number, head: string): Spawned {
  return { code: 0, stdout: JSON.stringify(listedPullRequest({ number, head })), stderr: "" };
}

/**
 * Built: GitHub's 422 to the POST when a pull request from the head into the base is open
 * already. The errors are the body that note 09 reports (section 2.7, not probed); the
 * documentation_url and the status follow the shape of every probed error body (section 1.2).
 */
function alreadyExistsAnswer(head: string): Spawned {
  return {
    code: 1,
    stdout: JSON.stringify({
      message: "Validation Failed",
      errors: [
        {
          resource: "PullRequest",
          code: "custom",
          message: `A pull request already exists for acmelabs-15:${head}.`,
        },
      ],
      documentation_url: "https://docs.github.com/rest/pulls/pulls#create-a-pull-request",
      status: "422",
    }),
    stderr: "gh: Validation Failed (HTTP 422)\n",
  };
}

describe("openPullRequest", () => {
  test("an open PR from the head into the base gives a skipped step, made reused, and no POST", async () => {
    const world = fakeWorld({
      spawn: [ghScripted(listAddBrain, listAnswer({ number: 12, head: "add-brain" }))],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pullRequestCommand, addBrain, caller);
    expect(outcome).toEqual({
      ok: true,
      command: "sample pull-request",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: {
        number: 12,
        url: "https://github.com/acmelabs-15/marketplace/pull/12",
        made: "reused",
      },
    });
    expect(caller.updates).toEqual([
      pullStep("add-brain", "started"),
      pullStep(
        "add-brain",
        "skipped",
        "already open: https://github.com/acmelabs-15/marketplace/pull/12",
      ),
    ]);
    expect(world.calls).toEqual([ghLogged(listAddBrain)]);
  });

  test("no open PR gives a POST with the title, head, base and body, the body on stdin, and a done step, made created", async () => {
    const world = fakeWorld({
      spawn: [
        ghScripted(listAddBrain, noOpenPullRequests),
        ghScripted(createAddBrain, createdAnswer(13, "add-brain")),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pullRequestCommand, addBrain, caller);
    expect(outcome).toEqual({
      ok: true,
      command: "sample pull-request",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: {
        number: 13,
        url: "https://github.com/acmelabs-15/marketplace/pull/13",
        made: "created",
      },
    });
    expect(caller.updates).toEqual([
      pullStep("add-brain", "started"),
      pullStep("add-brain", "done", "https://github.com/acmelabs-15/marketplace/pull/13"),
    ]);
    expect(world.calls).toEqual([ghLogged(listAddBrain), ghLogged(createAddBrain)]);
  });

  test("an open PR from another head, another repo, or into another base is not reused: the step opens its own", async () => {
    // GitHub ignores a head filter that it cannot read, and lists every PR (probed on 2026-10-20).
    const world = fakeWorld({
      spawn: [
        ghScripted(
          listAddBrain,
          listAnswer(
            { number: 7, head: "add-jev-gate" },
            { number: 8, head: "add-brain", headRepo: "someone/marketplace" },
            { number: 9, head: "add-brain", headRepo: null },
            { number: 10, head: "add-brain", base: "release" },
          ),
        ),
        ghScripted(createAddBrain, createdAnswer(13, "add-brain")),
      ],
    });
    const outcome = await runCommand(pullRequestCommand, addBrain, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { number: 13, made: "created" } });
    expect(world.calls).toEqual([ghLogged(listAddBrain), ghLogged(createAddBrain)]);
  });

  test("a head repo named in other letter case is the same repo: its open PR is reused", async () => {
    // GitHub's owner and repo names do not tell upper case from lower case.
    const world = fakeWorld({
      spawn: [
        ghScripted(
          {
            path: "repos/ACMElabs-15/Marketplace/pulls?head=ACMElabs-15%3Aadd-brain&base=main&state=open&per_page=100",
          },
          listAnswer({ number: 12, head: "add-brain" }),
        ),
      ],
    });
    const outcome = await runCommand(
      pullRequestCommand,
      { ...addBrain, owner: "ACMElabs-15", name: "Marketplace" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { number: 12, made: "reused" } });
  });
});

describe("openPullRequest: the head in the query", () => {
  test("a branch with /, #, &, + or % reaches GitHub whole: the query encodes it, and the body carries it as it is", async () => {
    const head = "add/brain#2&state=closed+x%y";
    const list = {
      path: "repos/acmelabs-15/marketplace/pulls?head=acmelabs-15%3Aadd%2Fbrain%232%26state%3Dclosed%2Bx%25y&base=main&state=open&per_page=100",
    };
    const create = {
      method: "POST",
      path: "repos/acmelabs-15/marketplace/pulls",
      stdin:
        '{"title":"Add brain","head":"add/brain#2&state=closed+x%y","base":"main","body":"Adds brain."}',
    } as const;
    const world = fakeWorld({
      spawn: [ghScripted(list, noOpenPullRequests), ghScripted(create, createdAnswer(13, head))],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      pullRequestCommand,
      { ...addBrain, head, body: "Adds brain." },
      caller,
    );
    expect(outcome).toMatchObject({ ok: true, result: { number: 13, made: "created" } });
    expect(caller.updates[0]).toEqual(pullStep(head, "started"));
    expect(world.calls).toEqual([ghLogged(list), ghLogged(create)]);
  });

  test("a base branch is encoded in the query too", async () => {
    const list = {
      path: "repos/acmelabs-15/marketplace/pulls?head=acmelabs-15%3Aadd-brain&base=release%2F1.x&state=open&per_page=100",
    };
    const world = fakeWorld({
      spawn: [ghScripted(list, listAnswer({ number: 12, head: "add-brain", base: "release/1.x" }))],
    });
    const outcome = await runCommand(
      pullRequestCommand,
      { ...addBrain, base: "release/1.x" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { number: 12, made: "reused" } });
    expect(world.calls).toEqual([ghLogged(list)]);
  });
});

describe("openPullRequest: a PR that opens between the read and the POST", () => {
  test("a 422 'A pull request already exists' reads the list again and reuses the PR, with no second POST", async () => {
    const world = fakeWorld({
      spawn: [
        ghScripted(listAddBrain, noOpenPullRequests),
        ghScripted(createAddBrain, alreadyExistsAnswer("add-brain")),
        ghScripted(listAddBrain, listAnswer({ number: 14, head: "add-brain" })),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pullRequestCommand, addBrain, caller);
    expect(outcome).toMatchObject({
      ok: true,
      exitCode: 0,
      result: {
        number: 14,
        url: "https://github.com/acmelabs-15/marketplace/pull/14",
        made: "reused",
      },
    });
    expect(caller.updates).toEqual([
      pullStep("add-brain", "started"),
      pullStep(
        "add-brain",
        "skipped",
        "already open: https://github.com/acmelabs-15/marketplace/pull/14",
      ),
    ]);
    expect(world.calls).toEqual([
      ghLogged(listAddBrain),
      ghLogged(createAddBrain),
      ghLogged(listAddBrain),
    ]);
  });

  test("a 422 'A pull request already exists' with no open PR on the second read ends with exit 3, naming GitHub's message", async () => {
    const world = fakeWorld({
      spawn: [
        ghScripted(listAddBrain, noOpenPullRequests),
        ghScripted(createAddBrain, alreadyExistsAnswer("add-brain")),
        ghScripted(listAddBrain, noOpenPullRequests),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pullRequestCommand, addBrain, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample pull-request",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          "GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: A pull request already exists for acmelabs-15:add-brain. But GitHub lists no open pull request from add-brain into main on acmelabs-15/marketplace; wait, then run the command again",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([
      pullStep("add-brain", "started"),
      pullStep("add-brain", "failed"),
    ]);
    expect(world.calls).toEqual([
      ghLogged(listAddBrain),
      ghLogged(createAddBrain),
      ghLogged(listAddBrain),
    ]);
  });

  test("another 422 on the POST ends by the table, exit 3, and reads the list no more", async () => {
    // Built: GitHub's 422 when the head holds no commit that the base lacks (reported, not probed).
    const noCommits = {
      code: 1,
      stdout:
        '{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"No commits between main and add-brain"}],"documentation_url":"https://docs.github.com/rest/pulls/pulls#create-a-pull-request","status":"422"}',
      stderr: "gh: Validation Failed (HTTP 422)\n",
    };
    const world = fakeWorld({
      spawn: [ghScripted(listAddBrain, noOpenPullRequests), ghScripted(createAddBrain, noCommits)],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(pullRequestCommand, addBrain, caller);
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: Validation Failed",
      },
    });
    expect(caller.updates).toEqual([
      pullStep("add-brain", "started"),
      pullStep("add-brain", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(listAddBrain), ghLogged(createAddBrain)]);
  });

  test("a 404 on the POST is final at once, with no wait and no second POST", async () => {
    // GitHub may have opened the pull request, and a second POST could open a second one.
    const world = fakeWorld({
      spawn: [
        ghScripted(listAddBrain, noOpenPullRequests),
        ghScripted(createAddBrain, ghAnswers.notFound),
      ],
    });
    const outcome = await runCommand(pullRequestCommand, addBrain, frontEnd(world));
    expect(outcome).toMatchObject({ ok: false, exitCode: 2, error: { kind: "input" } });
    expect(world.calls).toEqual([ghLogged(listAddBrain), ghLogged(createAddBrain)]);
  });
});

describe("openPullRequest: the branch check, before any call", () => {
  /** The rule each branch name must pass, as an issue's message gives it after the name. */
  const branchRule =
    "is not a branch name; a branch name has at least one character, and no control character or colon";

  test.each([
    ["head", "no characters", ""],
    ["head", "a newline", "add-brain\n"],
    ["head", "an escape", "add-\u001B[2Jbrain"],
    ["head", "a delete", "add-brain\u007F"],
    ["head", "a C1 control character", "add-\u009Bbrain"],
    ["head", "a colon, which names another owner's branch", "someone:add-brain"],
    ["base", "no characters", ""],
    ["base", "a tab", "ma\tin"],
    ["base", "a colon", "acmelabs-15:main"],
  ])("a %s with %s ends with exit 2, and makes no call", async (field, _case, branch) => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(pullRequestCommand, { ...addBrain, [field]: branch }, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample pull-request",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message: "the pull request's head or base is not a branch name",
        issues: [{ field, message: `${JSON.stringify(branch)} ${branchRule}` }],
      },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("a head and a base that both fail give one issue each", async () => {
    const world = fakeWorld();
    const outcome = await runCommand(
      pullRequestCommand,
      { ...addBrain, head: "", base: "a:b" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        issues: [
          { field: "head", message: `"" ${branchRule}` },
          { field: "base", message: `"a:b" ${branchRule}` },
        ],
      },
    });
    expect(world.calls).toEqual([]);
  });

  test("a repo name that fails the name check ends with exit 2 before the step starts, and makes no call", async () => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(pullRequestCommand, { ...addBrain, name: "../user" }, caller);
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: { kind: "input", message: '"acmelabs-15/../user" is not a GitHub repo' },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });
});
