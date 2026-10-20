import { describe, expect, expectTypeOf, test } from "bun:test";

import { z } from "zod";

import type { Context } from "../../command/command";
import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { StepContext } from "../gh";
import { answerOrThrow, ghApi, repoPath } from "../gh";
import { frontEnd, ghAnswers, ghCommandLine, ghLogged, ghScripted } from "./gh-answers";

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

describe("ghApi: an answer that is not ok goes back to the step", () => {
  /** A sample command that reads a repo's latest tag, and gives a failed answer as its result. */
  const latestTag = defineCommand({
    path: ["sample", "latest-tag"],
    summary: "Read a GitHub repo's latest tag.",
    input: z.object({
      owner: z.string().describe("The repo's owner, such as acmelabs-15."),
      name: z.string().describe("The repo's name."),
    }),
    async run(input, context) {
      const answer = await ghApi(context, { path: repoPath(input, "git/ref/tags/latest") });
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

  test("a 404, no such tag, comes back with its status", async () => {
    const call = { path: "repos/acmelabs-15/cli/git/ref/tags/latest" };
    const world = fakeWorld({ spawn: [ghScripted(call, ghAnswers.notFound)] });
    const outcome = await runCommand(
      latestTag,
      { owner: "acmelabs-15", name: "cli" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { status: 404, message: "Not Found" } });
  });
});

describe("answerOrThrow: an answer that the step does not expect", () => {
  test("a 404 ends with exit 2, naming the repo and the gh login", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.notFound)] });
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
  });

  test("an error body with no status gets its status from gh's line on stderr", async () => {
    // GitHub's error bodies carried `status` in every probe of note 09, and older reports show
    // bodies without it; gh's stderr line names the HTTP code in either case (note 09, 1.2).
    const world = fakeWorld({
      spawn: [
        ghScripted(brainSetting.call, {
          code: 1,
          stdout: '{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}',
          stderr: "gh: Not Found (HTTP 404)\n",
        }),
      ],
    });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({ exitCode: 2, error: { kind: "input" } });
  });

  test("a 403 that is not a rate limit ends with exit 2, naming the repo, the login and GitHub's message", async () => {
    const world = fakeWorld({ spawn: [ghScripted(brainSetting.call, ghAnswers.orgAdminNeeded)] });
    const outcome = await runCommand(read, brainSetting.input, frontEnd(world));
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "GitHub refused GET repos/acmelabs-15/brain/actions/permissions/workflow for the gh login, which needs more access to acmelabs-15/brain (HTTP 403): You must be an org admin or have the actions policies fine-grained permission.",
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
