import { describe, expect, expectTypeOf, test } from "bun:test";

import { z } from "zod";

import type { Context } from "../../command/command";
import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { Spawned } from "../../command/world";
import type { GhRequest, StepContext } from "../gh";
import { answerOrThrow, ghApi, readBody, repoPath } from "../gh";
import {
  frontEnd,
  ghAnswers,
  ghCommandLine,
  ghLogged,
  ghLoggedEveryTry,
  ghScripted,
  ghScriptedEveryTry,
} from "./gh-answers";

/** A sample command that reads one of a repo's resources through ghApi, and gives its body. */
const read = defineCommand({
  path: ["sample", "read"],
  summary: "Read one of a GitHub repo's resources.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
    rest: z.string().describe("The resource's path in the repo, such as git/ref/tags/latest."),
  }),
  async run(input, context) {
    const answer = await ghApi(context, { path: repoPath(input, input.rest) });
    return answerOrThrow(answer, input);
  },
});

/** The read of the Actions setting of acmelabs-15/brain: the input, and the call. */
const brainSetting = {
  input: { owner: "acmelabs-15", name: "brain", rest: "actions/permissions/workflow" },
  call: { path: "repos/acmelabs-15/brain/actions/permissions/workflow" },
} as const;

describe("StepContext", () => {
  test("is a command's context without ask, so any command's context passes as one", () => {
    // A type test: tsc checks it in `bun run typecheck`.
    expectTypeOf<Context<{ owner: string; tag?: string }>>().toExtend<StepContext>();
    expectTypeOf<Context<Record<string, never>>>().toExtend<StepContext>();
    expectTypeOf<StepContext>().not.toHaveProperty("ask");
  });
});

describe("GhRequest", () => {
  test("expected names only a 404 or a 409, the statuses that ghApi tries again", () => {
    // A type test: tsc checks it in `bun run typecheck`.
    expectTypeOf<GhRequest["expected"]>().toEqualTypeOf<readonly (404 | 409)[] | undefined>();
  });
});

describe("ghApi: an ok answer", () => {
  test("gives GitHub's JSON body, from one gh api call with gh's two variables", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.actionsSetting)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: true,
      command: "sample read",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: { default_workflow_permissions: "read", can_approve_pull_request_reviews: true },
    });
    expect(world.calls).toEqual([ghLogged(brainSetting.call)]);
  });
});

describe("ghApi: an unexpected 404 or 409 is tried again", () => {
  test.each([
    ["a 404", ghAnswers.notFound],
    ["a 409", ghAnswers.repositoryEmpty],
  ])("%s, then a 200, gives the 200 after one 3-second wait", async (_case, first) => {
    const world = fakeWorld({
      spawn: [
        ghScripted(brainSetting.call, first),
        ghScripted(brainSetting.call, ghAnswers.actionsSetting),
      ],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      ok: true,
      result: { default_workflow_permissions: "read", can_approve_pull_request_reviews: true },
    });
    expect(world.calls).toEqual([
      ghLogged(brainSetting.call),
      { kind: "sleep", ms: 3000 },
      ghLogged(brainSetting.call),
    ]);
  });

  test("four 409s end with exit 3 after three 3-second waits, as the table's other answers", async () => {
    const world = fakeWorld({
      spawn: ghScriptedEveryTry(brainSetting.call, ghAnswers.repositoryEmpty),
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub answered GET repos/acmelabs-15/brain/actions/permissions/workflow with HTTP 409: Git Repository is empty.",
      },
    });
    expect(world.calls).toEqual(ghLoggedEveryTry(brainSetting.call));
  });

  test.each([
    ["a 401", ghAnswers.badCredentials, 4],
    ["a 403", ghAnswers.adminRightsNeeded, 2],
    ["a 403 that names a missing scope", ghAnswers.orgAdminNeeded, 4],
    ["a rate-limit 403", ghAnswers.rateLimited, 3],
    ["a rate-limit 429", ghAnswers.secondaryRateLimited, 3],
    ["a 451", ghAnswers.accessBlocked, 3],
    ["a 502", ghAnswers.serverError, 3],
  ])("%s is final at once: only a 404 or a 409 is tried again", async (_case, answer, exitCode) => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, answer)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({ ok: false, exitCode });
    expect(world.calls).toEqual([ghLogged(brainSetting.call)]);
  });

  test("a cancel during a wait ends with exit 130, and the call goes to gh no more", async () => {
    const world = fakeWorld({ spawn: ghScriptedEveryTry(brainSetting.call, ghAnswers.notFound) });
    const cancel = new AbortController();
    // The user presses Ctrl+C as the first wait starts.
    const cancelledAtSleep = {
      ...world,
      sleep(ms: number, options?: { signal?: AbortSignal }) {
        cancel.abort();
        return world.sleep(ms, options);
      },
    };
    const outcome = await runCommand(read, brainSetting.input, {
      ...frontEnd(cancelledAtSleep),
      signal: cancel.signal,
    });
    expect(outcome).toMatchObject({ ok: false, exitCode: 130, error: { kind: "cancelled" } });
    expect(world.calls).toEqual([ghLogged(brainSetting.call), { kind: "sleep", ms: 3000 }]);
  });
});

describe("ghApi: an expected answer that is not ok goes back to the step at once", () => {
  /**
   * A sample command that reads a repo's latest tag, and gives a failed answer as its result. It
   * expects a 404, no such tag, and a 409, an empty repo, so neither is tried again.
   */
  const latestTag = defineCommand({
    path: ["sample", "latest-tag"],
    summary: "Read a GitHub repo's latest tag.",
    input: z.object({
      owner: z.string().describe("The repo's owner, such as acmelabs-15."),
      name: z.string().describe("The repo's name."),
    }),
    async run(input, context) {
      const answer = await ghApi(context, {
        path: repoPath(input, "git/ref/tags/latest"),
        expected: [404, 409],
      });
      return answer.ok
        ? "found"
        : { status: answer.status, message: answer.message, body: answer.body };
    },
  });

  test("a 409, an empty repo, comes back with its status, GitHub's message and the body", async () => {
    const call = { path: "repos/acmelabs-15/pinky/git/ref/tags/latest" };
    const world = fakeWorld({ spawn: [ghScripted(call, ghAnswers.repositoryEmpty)] });
    const outcome = await runCommand(
      latestTag,
      { owner: "acmelabs-15", name: "pinky" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        status: 409,
        message: "Git Repository is empty.",
        body: {
          message: "Git Repository is empty.",
          documentation_url: "https://docs.github.com/rest/git/refs#get-a-reference",
          status: "409",
        },
      },
    });
    expect(world.calls).toEqual([ghLogged(call)]);
  });

  test("a 404, no such tag, comes back with its status, and no wait", async () => {
    const call = { path: "repos/acmelabs-15/cli/git/ref/tags/latest" };
    const world = fakeWorld({ spawn: [ghScripted(call, ghAnswers.notFound)] });
    const outcome = await runCommand(
      latestTag,
      { owner: "acmelabs-15", name: "cli" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { status: 404, message: "Not Found" } });
    expect(world.calls).toEqual([ghLogged(call)]);
  });
});

describe("answerOrThrow: an answer that the step does not expect", () => {
  test("four 404s end with exit 2 after three 3-second waits, naming the repo and the gh login", async () => {
    const world = fakeWorld({ spawn: ghScriptedEveryTry(brainSetting.call, ghAnswers.notFound) });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample read",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          "GitHub found no repo acmelabs-15/brain for the gh login (HTTP 404 on GET repos/acmelabs-15/brain/actions/permissions/workflow); check the owner and the name, and the login's access to the repo",
        issues: [],
      },
    });
    expect(world.calls).toEqual(ghLoggedEveryTry(brainSetting.call));
  });

  test("an error body with no status gets its status from gh's line on stderr", async () => {
    // GitHub's error bodies carried `status` in every probe of note 09, and older reports show
    // bodies without it; gh's stderr line names the HTTP code in either case (note 09, 1.2).
    const world = fakeWorld({
      spawn: ghScriptedEveryTry(brainSetting.call, {
        code: 1,
        stdout: '{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
        stderr: "gh: Not Found (HTTP 404)\n",
      }),
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({ exitCode: 2, error: { kind: "input" } });
  });

  test("a 403 that is not a rate limit ends with exit 2, naming the repo, the login and GitHub's message", async () => {
    const world = fakeWorld({
      spawn: [ghScripted(brainSetting.call, ghAnswers.adminRightsNeeded)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "GitHub refused GET repos/acmelabs-15/brain/actions/permissions/workflow for the gh login, which needs more access to acmelabs-15/brain (HTTP 403): Must have admin rights to Repository.",
      },
    });
  });
});

/** gh's answer to an HTTP error with a scope line: `answer`'s stderr, then the line for `scope`. */
function withScopeLine(answer: Spawned, scope: string): Spawned {
  // gh's own text, with the two spaces after "run:" (note 09, section 1.2).
  const line = `gh: This API operation needs the "${scope}" scope. To request it, run:  gh auth refresh -h github.com -s ${scope}\n`;
  return { ...answer, stderr: `${answer.stderr}${line}` };
}

/**
 * Built: gh's answer to a 422 whose error body adds these fields to GitHub's "Validation Failed":
 * the body on stdout, and gh's line for it, which leaves out the errors (note 09, section 1.2).
 */
function validationFailed(fields: object): Spawned {
  return {
    code: 1,
    stdout: JSON.stringify({ message: "Validation Failed", ...fields, status: "422" }),
    stderr: "gh: Validation Failed (HTTP 422)\n",
  };
}

describe("answerOrThrow: a scope that the gh login lacks", () => {
  test("a 403 for which gh names a missing scope ends with exit 4, naming gh auth refresh with that scope", async () => {
    // Real: the org's Actions setting with a token that lacks admin:org (note 09, section 2.5).
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.orgAdminNeeded)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample read",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s admin:org, then run the command again",
        issues: [],
      },
    });
  });

  test.each(["repo", "workflow", "write:packages", "admin:repo_hook"])(
    "the scope %s goes into the command line as gh names it",
    async (scope) => {
      const world = fakeWorld({
        spawn: [ghScripted(brainSetting.call, withScopeLine(ghAnswers.adminRightsNeeded, scope))],
      });
      const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
      expect(outcome).toMatchObject({
        exitCode: 4,
        error: {
          kind: "login",
          message: `gh needs a login; run gh auth refresh -h github.com -s ${scope}, then run the command again`,
        },
      });
    },
  );

  test("a 404 for which gh names a missing scope ends with exit 4 at once, with no wait", async () => {
    // Built: a token without repo gets 404 for a private repo, and the endpoint checks repo.
    const world = fakeWorld({
      spawn: [ghScripted(brainSetting.call, withScopeLine(ghAnswers.notFound, "repo"))],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s repo, then run the command again",
      },
    });
    expect(world.calls).toEqual([ghLogged(brainSetting.call)]);
  });

  test.each([
    ["a shell command", "admin:org; rm -rf ~"],
    ["a space", "admin org"],
    ["a quote, which gh escapes", String.raw`admin\"org`],
    ["capital letters", "Admin:Org"],
    ["two colons", "admin:org:x"],
    ["no characters", ""],
  ])(
    "a scope with %s names no command line: the 403 ends with exit 2, as the table's 403",
    async (_case, scope) => {
      const world = fakeWorld({
        spawn: [ghScripted(brainSetting.call, withScopeLine(ghAnswers.adminRightsNeeded, scope))],
      });
      const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
      expect(outcome).toMatchObject({
        exitCode: 2,
        error: {
          kind: "input",
          message:
            "GitHub refused GET repos/acmelabs-15/brain/actions/permissions/workflow for the gh login, which needs more access to acmelabs-15/brain (HTTP 403): Must have admin rights to Repository.",
        },
      });
    },
  );

  test("gh's own scope line wins over one inside GitHub's message, which gh prints first", async () => {
    // Built: a GitHub message that holds a line in the shape of gh's scope line.
    const forged = {
      code: 1,
      stdout:
        '{"message":"Not allowed\\ngh: This API operation needs the \\"delete_repo\\" scope.","status":"403"}',
      stderr: 'gh: Not allowed\ngh: This API operation needs the "delete_repo" scope. (HTTP 403)\n',
    };
    const world = fakeWorld({
      spawn: [ghScripted(brainSetting.call, withScopeLine(forged, "admin:org"))],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        message:
          "gh needs a login; run gh auth refresh -h github.com -s admin:org, then run the command again",
      },
    });
  });

  test("a 401 stays gh auth login when gh names a scope too: GitHub rejected the token itself", async () => {
    const world = fakeWorld({
      spawn: [ghScripted(brainSetting.call, withScopeLine(ghAnswers.badCredentials, "repo"))],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
      },
    });
  });

  test("a rate-limit 403 stays exit 3 when gh names a scope too: the limit is this answer's cause", async () => {
    const world = fakeWorld({
      spawn: [ghScripted(brainSetting.call, withScopeLine(ghAnswers.rateLimited, "admin:org"))],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({ exitCode: 3, error: { kind: "outside" } });
  });
});

describe("answerOrThrow: a 404 on a write names the access, not a missing repo", () => {
  /** A sample command that writes an empty JSON object to one of a repo's resources. */
  const write = defineCommand({
    path: ["sample", "write"],
    summary: "Write to one of a GitHub repo's resources.",
    input: z.object({
      owner: z.string().describe("The repo's owner, such as acmelabs-15."),
      name: z.string().describe("The repo's name."),
      rest: z.string().describe("The resource's path in the repo, such as rulesets."),
      method: z.enum(["POST", "PUT"]).describe("The write's HTTP method."),
    }),
    async run(input, context) {
      const path = repoPath(input, input.rest);
      const answer = await ghApi(context, { method: input.method, path, body: {} });
      return answerOrThrow(answer, input);
    },
  });

  test("a 404 on a POST ends with exit 2 at once, naming the POST, the path and the login's write access", async () => {
    const call = { method: "POST", path: "repos/acmelabs-15/cli/rulesets", stdin: "{}" } as const;
    const world = fakeWorld({ spawn: [ghScripted(call, ghAnswers.notFound)] });
    const outcome = await runCommand(
      write,
      { owner: "acmelabs-15", name: "cli", rest: "rulesets", method: "POST" },
      frontEnd(world),
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample write",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          "GitHub answered POST repos/acmelabs-15/cli/rulesets with HTTP 404: the gh login may lack write access to acmelabs-15/cli, or the resource may not exist",
        issues: [],
      },
    });
    expect(world.calls).toEqual([ghLogged(call)]);
  });

  test("a 404 on a PUT that stays after every try ends with exit 2, naming the PUT, the path and the login's write access", async () => {
    const call = {
      method: "PUT",
      path: "repos/acmelabs-15/brain/rulesets/25457893",
      stdin: "{}",
    } as const;
    const world = fakeWorld({ spawn: ghScriptedEveryTry(call, ghAnswers.notFound) });
    const outcome = await runCommand(
      write,
      { owner: "acmelabs-15", name: "brain", rest: "rulesets/25457893", method: "PUT" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "GitHub answered PUT repos/acmelabs-15/brain/rulesets/25457893 with HTTP 404: the gh login may lack write access to acmelabs-15/brain, or the resource may not exist",
      },
    });
    expect(world.calls).toEqual(ghLoggedEveryTry(call));
  });

  test("a 404 on a PUT for which gh names a missing scope ends with exit 4 at once, with no wait", async () => {
    const call = {
      method: "PUT",
      path: "repos/acmelabs-15/brain/rulesets/25457893",
      stdin: "{}",
    } as const;
    const world = fakeWorld({
      spawn: [ghScripted(call, withScopeLine(ghAnswers.notFound, "repo"))],
    });
    const outcome = await runCommand(
      write,
      { owner: "acmelabs-15", name: "brain", rest: "rulesets/25457893", method: "PUT" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s repo, then run the command again",
      },
    });
    expect(world.calls).toEqual([ghLogged(call)]);
  });
});

describe("answerOrThrow: GitHub's first error joins its message", () => {
  /** A sample command that opens a pull request on a repo from a body of no fields. */
  const create = defineCommand({
    path: ["sample", "create"],
    summary: "Open a pull request on a GitHub repo.",
    input: z.object({
      owner: z.string().describe("The repo's owner, such as acmelabs-15."),
      name: z.string().describe("The repo's name."),
    }),
    async run(input, context) {
      const answer = await ghApi(context, {
        method: "POST",
        path: repoPath(input, "pulls"),
        body: {},
      });
      return answerOrThrow(answer, input);
    },
  });

  /** The POST of a pull request on acmelabs-15/marketplace: the input, and the call. */
  const marketplacePull = {
    input: { owner: "acmelabs-15", name: "marketplace" },
    call: { method: "POST", path: "repos/acmelabs-15/marketplace/pulls", stdin: "{}" },
  } as const;

  test("a 422 names GitHub's message, then the first error, such as No commits between the branches", async () => {
    // Built: GitHub's 422 when the head holds no commit that the base lacks (task 12's body,
    // reported, not probed).
    const noCommits = {
      code: 1,
      stdout:
        '{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"No commits between main and add-brain"}],"documentation_url":"https://docs.github.com/rest/pulls/pulls#create-a-pull-request","status":"422"}',
      stderr: "gh: Validation Failed (HTTP 422)\n",
    };
    const world = fakeWorld({ spawn: [ghScripted(marketplacePull.call, noCommits)] });
    const outcome = await runCommand(create, marketplacePull.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample create",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          "GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: Validation Failed (No commits between main and add-brain)",
        issues: [],
      },
    });
    expect(world.calls).toEqual([ghLogged(marketplacePull.call)]);
  });

  // gh reads `errors` in these shapes too: one text, or a list of texts and objects; an object
  // without a message adds nothing (`parseErrorResponse` in pkg/cmd/api/api.go at v2.98.0).
  test.each([
    ["one text", { errors: "No commits between main and add-brain" }],
    ["a list of texts", { errors: ["No commits between main and add-brain", "a second error"] }],
    [
      "a list whose first object has no message",
      {
        errors: [
          { resource: "PullRequest", field: "head", code: "invalid" },
          {
            resource: "PullRequest",
            code: "custom",
            message: "No commits between main and add-brain",
          },
        ],
      },
    ],
  ])("errors as %s: the first error with a text joins GitHub's message", async (_case, body) => {
    const world = fakeWorld({
      spawn: [ghScripted(marketplacePull.call, validationFailed(body))],
    });
    const outcome = await runCommand(create, marketplacePull.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: Validation Failed (No commits between main and add-brain)",
      },
    });
  });

  test("errors with no text keep GitHub's message alone", async () => {
    const world = fakeWorld({
      spawn: [
        ghScripted(
          marketplacePull.call,
          validationFailed({
            errors: [{ resource: "PullRequest", field: "head", code: "invalid" }],
          }),
        ),
      ],
    });
    const outcome = await runCommand(create, marketplacePull.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        message:
          "GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: Validation Failed",
      },
    });
  });

  test("GitHub's texts show on one line, with no escape or bidi character, and each stops at 300 characters", async () => {
    // Built: GitHub's texts can echo what a request sent, so they reach a terminal as untrusted
    // text. An error of only a line break counts as no text.
    const world = fakeWorld({
      spawn: [
        ghScripted(
          marketplacePull.call,
          validationFailed({
            message: "Validation\u001B[31m Failed",
            errors: ["\n", `No commits\nbetween\u202Emain and add-brain ${"x".repeat(400)}`],
          }),
        ),
      ],
    });
    const outcome = await runCommand(create, marketplacePull.input, frontEnd(world));
    // The first 300 characters of the error: the 38 of "No commits ... add-brain ", then 262 x,
    // a part of a word, which is dropped.
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        message:
          "GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: Validation [31m Failed (No commits between main and add-brain...)",
      },
    });
  });

  test("a cut right after a space keeps every word before it", async () => {
    // The 300th character is a space, so the cut splits no word, and none goes.
    const world = fakeWorld({
      spawn: [
        ghScripted(marketplacePull.call, validationFailed({ errors: [`${"x".repeat(299)} next`] })),
      ],
    });
    const outcome = await runCommand(create, marketplacePull.input, frontEnd(world));
    expect(outcome).toMatchObject({
      error: {
        message: `GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: Validation Failed (${"x".repeat(299)}...)`,
      },
    });
  });

  test("the cut at 300 characters keeps a two-unit character whole", async () => {
    // An emoji is two UTF-16 units; a cut by units at 300 would leave half of this one.
    const world = fakeWorld({
      spawn: [
        ghScripted(
          marketplacePull.call,
          validationFailed({ errors: [`${"x".repeat(298)} \u{1F600} tail`] }),
        ),
      ],
    });
    const outcome = await runCommand(create, marketplacePull.input, frontEnd(world));
    expect(outcome).toMatchObject({
      error: {
        message: `GitHub answered POST repos/acmelabs-15/marketplace/pulls with HTTP 422: Validation Failed (${"x".repeat(298)} \u{1F600}...)`,
      },
    });
  });

  test("a 403 that is not a rate limit names the first error too", async () => {
    // Built: a 403 whose body carries errors.
    const world = fakeWorld({
      spawn: [
        ghScripted(brainSetting.call, {
          code: 1,
          stdout:
            '{"message":"Must have admin rights to Repository.","errors":[{"message":"the login has write access only"}],"status":"403"}',
          stderr: "gh: Must have admin rights to Repository. (HTTP 403)\n",
        }),
      ],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "GitHub refused GET repos/acmelabs-15/brain/actions/permissions/workflow for the gh login, which needs more access to acmelabs-15/brain (HTTP 403): Must have admin rights to Repository. (the login has write access only)",
      },
    });
  });

  test("a rate-limit 403 names the first error too", async () => {
    // Built: a rate-limit 403 whose body carries errors.
    const world = fakeWorld({
      spawn: [
        ghScripted(brainSetting.call, {
          code: 1,
          stdout:
            '{"message":"API rate limit exceeded for user ID 1234567.","errors":["the limit resets in 30 minutes"],"status":"403"}',
          stderr: "gh: API rate limit exceeded for user ID 1234567. (HTTP 403)\n",
        }),
      ],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub's rate limit stopped GET repos/acmelabs-15/brain/actions/permissions/workflow; wait, then run the command again (HTTP 403): API rate limit exceeded for user ID 1234567. (the limit resets in 30 minutes)",
      },
    });
  });
});

describe("readBody: an ok answer's body, read with a schema", () => {
  /** A sample command that reads the ids and names of a repo's own rulesets through readBody. */
  const rulesetNames = defineCommand({
    path: ["sample", "ruleset-names"],
    summary: "Read the ids and names of a GitHub repo's own rulesets.",
    input: z.object({
      owner: z.string().describe("The repo's owner, such as acmelabs-15."),
      name: z.string().describe("The repo's name."),
    }),
    async run(input, context) {
      const path = repoPath(input, "rulesets?includes_parents=false&per_page=100");
      const answer = await ghApi(context, { path });
      return readBody(answer, input, z.array(z.object({ id: z.number(), name: z.string() })));
    },
  });

  /** The list call of acmelabs-15/brain's rulesets. */
  const brainRulesets = {
    path: "repos/acmelabs-15/brain/rulesets?includes_parents=false&per_page=100",
  };

  test("a body of the schema's shape comes back as the schema reads it, without GitHub's other fields", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainRulesets, ghAnswers.rulesetsOfBrain)] });
    const outcome = await runCommand(
      rulesetNames,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toEqual({
      ok: true,
      command: "sample ruleset-names",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: [{ id: 25_457_893, name: "Protect main" }],
    });
    expect(world.calls).toEqual([ghLogged(brainRulesets)]);
  });

  test("a body of another shape ends with exit 3, naming the call and what was wrong", async () => {
    // A ruleset where the list should be: GitHub answered something the step cannot read.
    const world = fakeWorld({ spawn: [ghScripted(brainRulesets, ghAnswers.protectMainOfBrain)] });
    const outcome = await runCommand(
      rulesetNames,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample ruleset-names",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/rulesets?includes_parents=false&per_page=100 gave an answer that acmelabs cannot read: Invalid input: expected array, received object",
        issues: [{ field: "", message: "Invalid input: expected array, received object" }],
      },
    });
  });

  test("an item of another shape is named by its place in the body; the message names the first and counts the rest", async () => {
    const world = fakeWorld({
      spawn: [
        ghScripted(brainRulesets, {
          code: 0,
          stdout: '[{"id":"25457893","name":"Protect main"},{"id":25457894}]',
          stderr: "",
        }),
      ],
    });
    const outcome = await runCommand(
      rulesetNames,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/rulesets?includes_parents=false&per_page=100 gave an answer that acmelabs cannot read: [0].id: Invalid input: expected number, received string (and 1 more)",
        issues: [
          { field: "[0].id", message: "Invalid input: expected number, received string" },
          { field: "[1].name", message: "Invalid input: expected string, received undefined" },
        ],
      },
    });
  });

  test("an answer that is not ok ends with the table's failure, as answerOrThrow gives it", async () => {
    const world = fakeWorld({ spawn: ghScriptedEveryTry(brainRulesets, ghAnswers.notFound) });
    const outcome = await runCommand(
      rulesetNames,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "GitHub found no repo acmelabs-15/brain for the gh login (HTTP 404 on GET repos/acmelabs-15/brain/rulesets?includes_parents=false&per_page=100); check the owner and the name, and the login's access to the repo",
      },
    });
  });
});

describe("an outside failure: exit 3", () => {
  test("a rate-limit 403 ends with exit 3, naming the call and GitHub's message", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.rateLimited)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample read",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          "GitHub's rate limit stopped GET repos/acmelabs-15/brain/actions/permissions/workflow; wait, then run the command again (HTTP 403): API rate limit exceeded for user ID 1234567.",
        issues: [],
      },
    });
  });

  test("a secondary rate-limit 429 ends with exit 3 too", async () => {
    const world = fakeWorld({
      spawn: [ghScripted(brainSetting.call, ghAnswers.secondaryRateLimited)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub's rate limit stopped GET repos/acmelabs-15/brain/actions/permissions/workflow; wait, then run the command again (HTTP 429): You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
      },
    });
  });

  test("a 5xx ends with exit 3, naming the call and GitHub's message", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.serverError)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub answered GET repos/acmelabs-15/brain/actions/permissions/workflow with HTTP 502: Server Error",
      },
    });
  });

  test("an answer the table does not name ends with exit 3, naming the call and GitHub's message", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.accessBlocked)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "GitHub answered GET repos/acmelabs-15/brain/actions/permissions/workflow with HTTP 451: Repository access blocked",
      },
    });
  });

  test("an error answer that is not JSON ends with exit 3, naming the call and gh's stderr", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.htmlError)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/actions/permissions/workflow failed with exit 1: gh: HTTP 502",
      },
    });
  });

  test("gh's stderr in an unreadable answer shows on one line, with no escape, and stops at 300 characters", async () => {
    // Built: a proxy's page after gh's line, with an escape code, as gh's stderr can hold it.
    const world = fakeWorld({
      spawn: [
        ghScripted(brainSetting.call, {
          code: 1,
          stdout: "<!DOCTYPE html>\n<html><body><h1>502 Bad Gateway</h1></body></html>\n",
          stderr: `gh: HTTP 502\n\u001B[31m${"bad gateway ".repeat(40)}\n`,
        }),
      ],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    // The first 300 characters: the 17 of "gh: HTTP 502 [31m", 23 times "bad gateway ", then "bad
    // gat"; "gat" is a part of a word, which is dropped.
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message: `gh api GET repos/acmelabs-15/brain/actions/permissions/workflow failed with exit 1: gh: HTTP 502 [31m${"bad gateway ".repeat(23)}bad...`,
      },
    });
  });

  test("a cut inside a word drops the word whole, so no part of a token stays for the redaction to miss", async () => {
    // Built: a token that straddles the cut. The redaction of the World's secrets runs on the
    // whole message later, and finds only a whole token.
    const token = "not-a-real-token-0123456789";
    const world = fakeWorld({
      env: { GH_TOKEN: token },
      spawn: [
        ghScripted(brainSetting.call, {
          code: 1,
          stdout: "",
          stderr: `gh: ${"word ".repeat(58)}${token}\n`,
        }),
      ],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(JSON.stringify(outcome)).not.toContain("not-a-");
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message: `gh api GET repos/acmelabs-15/brain/actions/permissions/workflow failed with exit 1: gh: ${"word ".repeat(57)}word...`,
      },
    });
  });

  test("an error body with no status and no HTTP code from gh ends with exit 3, naming gh's stderr", async () => {
    const world = fakeWorld({
      spawn: [
        ghScripted(brainSetting.call, {
          code: 1,
          stdout: '{"message":"Validation Failed","errors":"the body is not valid"}',
          stderr: "gh: the body is not valid (Validation Failed)\n",
        }),
      ],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/actions/permissions/workflow failed with exit 1: gh: the body is not valid (Validation Failed)",
      },
    });
  });

  test("an ok answer that is not JSON ends with exit 3, naming the call", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.htmlPage)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/actions/permissions/workflow gave an answer that is not JSON",
      },
    });
  });

  test("gh not installed ends with exit 3, naming gh", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ghCommandLine(brainSetting.call), missing: true }],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: { kind: "outside", message: "gh is not installed or not on PATH" },
    });
  });

  test("a gh call past its time limit ends with exit 3, naming the limit", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ghCommandLine(brainSetting.call), limit: "time" }],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: { kind: "outside", message: "gh api ... ran longer than 5 minutes and was stopped" },
    });
  });
});

describe("ghApi: a login is needed", () => {
  test("gh's exit 4, no login at all, ends with exit 4 naming gh auth login", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.noLogin)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample read",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
        issues: [],
      },
    });
  });

  test("a 401, a token that GitHub rejects, ends with exit 4 naming gh auth login", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.badCredentials)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 4,
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
      },
    });
  });
});

describe("ghApi: a login failure for a token from GH_TOKEN or GITHUB_TOKEN", () => {
  // gh auth login and gh auth refresh refuse to run while gh's token comes from either variable
  // (note 09, section 1.4), so the message names the variable that gh reads, by gh's rule:
  // GH_TOKEN when it has text, else GITHUB_TOKEN (note 09, section 1.2).
  test("a 401 with GH_TOKEN set ends with exit 4, naming GH_TOKEN, then gh auth login after it is cleared", async () => {
    const world = fakeWorld({
      env: { GH_TOKEN: "not-a-real-token" },
      spawn: [ghScripted(brainSetting.call, ghAnswers.badCredentials)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample read",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message:
          "gh needs a login; replace the token in GH_TOKEN, or clear GH_TOKEN and run gh auth login, then run the command again",
        issues: [],
      },
    });
  });

  test("a 401 with only GITHUB_TOKEN set names GITHUB_TOKEN", async () => {
    const world = fakeWorld({
      env: { GITHUB_TOKEN: "also-not-a-real-token" },
      spawn: [ghScripted(brainSetting.call, ghAnswers.badCredentials)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; replace the token in GITHUB_TOKEN, or clear GITHUB_TOKEN and run gh auth login, then run the command again",
      },
    });
  });

  test("a 401 with both set names GH_TOKEN's token, and both variables to clear: gh reads GITHUB_TOKEN once GH_TOKEN is cleared", async () => {
    const world = fakeWorld({
      env: { GH_TOKEN: "not-a-real-token", GITHUB_TOKEN: "also-not-a-real-token" },
      spawn: [ghScripted(brainSetting.call, ghAnswers.badCredentials)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; replace the token in GH_TOKEN, or clear both GH_TOKEN and GITHUB_TOKEN and run gh auth login, then run the command again",
      },
    });
  });

  test("an empty GH_TOKEN counts as unset, as gh counts it: GITHUB_TOKEN is named alone", async () => {
    // go-gh reads a variable only when it has text (`tokenForHost` in pkg/auth/auth.go at v2.13.0).
    const world = fakeWorld({
      env: { GH_TOKEN: "", GITHUB_TOKEN: "also-not-a-real-token" },
      spawn: [ghScripted(brainSetting.call, ghAnswers.badCredentials)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; replace the token in GITHUB_TOKEN, or clear GITHUB_TOKEN and run gh auth login, then run the command again",
      },
    });
  });

  test("a scope that gh names as missing, with GH_TOKEN set, names GH_TOKEN, then gh auth refresh after it is cleared", async () => {
    const world = fakeWorld({
      env: { GH_TOKEN: "not-a-real-token" },
      spawn: [ghScripted(brainSetting.call, ghAnswers.orgAdminNeeded)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toEqual({
      ok: false,
      command: "sample read",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message:
          "gh needs a login; give the admin:org scope to the token in GH_TOKEN, or clear GH_TOKEN and run gh auth refresh -h github.com -s admin:org, then run the command again",
        issues: [],
      },
    });
  });

  test("a scope that gh names as missing, with both set, names GH_TOKEN's token, and both variables to clear", async () => {
    const world = fakeWorld({
      env: { GH_TOKEN: "not-a-real-token", GITHUB_TOKEN: "also-not-a-real-token" },
      spawn: [ghScripted(brainSetting.call, ghAnswers.orgAdminNeeded)],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; give the admin:org scope to the token in GH_TOKEN, or clear both GH_TOKEN and GITHUB_TOKEN and run gh auth refresh -h github.com -s admin:org, then run the command again",
      },
    });
  });
});
