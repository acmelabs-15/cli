import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { ProgressUpdate } from "../../command/command";
import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { Spawned } from "../../command/world";
import { findTag, watchRun } from "../runs";
import { frontEnd, ghAnswers, ghLogged, ghScripted } from "./gh-answers";

/** A sample command that reads a tag of a GitHub repo. */
const tagCommand = defineCommand({
  path: ["sample", "find-tag"],
  summary: "Read a tag of a GitHub repo.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
    tag: z.string().describe("The tag, such as latest."),
  }),
  run(input, context) {
    return findTag(context, { owner: input.owner, name: input.name }, input.tag);
  },
});

/**
 * acmelabs-15/brain's `latest` tag, a lightweight tag on commit 7dee2ef, read on 2026-10-20 under
 * API version 2026-03-10 (note 09, section 2.9).
 */
const latestOfBrain: Spawned = {
  code: 0,
  stdout:
    '{"ref":"refs/tags/latest","node_id":"REF_kwDORgonY7ByZWZzL3RhZ3MvbGF0ZXN0","url":"https://api.github.com/repos/acmelabs-15/brain/git/refs/tags/latest","object":{"sha":"7dee2ef38b7fadfa963ea14c76193457a2f19f91","type":"commit","url":"https://api.github.com/repos/acmelabs-15/brain/git/commits/7dee2ef38b7fadfa963ea14c76193457a2f19f91"}}',
  stderr: "",
};

/**
 * changesets/changesets's `@changesets/cli@2.27.1`, an annotated tag: its ref points at a tag
 * object. Read on 2026-10-20 under API version 2026-03-10.
 */
const annotatedRefOfChangesets: Spawned = {
  code: 0,
  stdout:
    '{"ref":"refs/tags/@changesets/cli@2.27.1","node_id":"MDM6UmVmMTc3MDMzNzQ4OnJlZnMvdGFncy9AY2hhbmdlc2V0cy9jbGlAMi4yNy4x","url":"https://api.github.com/repos/changesets/changesets/git/refs/tags/@changesets/cli@2.27.1","object":{"sha":"5f4a8bc561ec41be9ca7844c8cf2da99e2413e80","type":"tag","url":"https://api.github.com/repos/changesets/changesets/git/tags/5f4a8bc561ec41be9ca7844c8cf2da99e2413e80"}}',
  stderr: "",
};

/**
 * The tag object of `@changesets/cli@2.27.1`, which points at commit c11391b. Read on 2026-10-20
 * under API version 2026-03-10.
 */
const tagObjectOfChangesets: Spawned = {
  code: 0,
  stdout:
    '{"node_id":"TA_kwDOCo1SFNoAKDVmNGE4YmM1NjFlYzQxYmU5Y2E3ODQ0YzhjZjJkYTk5ZTI0MTNlODA","sha":"5f4a8bc561ec41be9ca7844c8cf2da99e2413e80","url":"https://api.github.com/repos/changesets/changesets/git/tags/5f4a8bc561ec41be9ca7844c8cf2da99e2413e80","tagger":{"name":"github-actions[bot]","email":"github-actions[bot]@users.noreply.github.com","date":"2023-11-28T11:18:23Z"},"object":{"sha":"c11391bc43be1b1c1afcad15b4abb6cf8ad6e354","type":"commit","url":"https://api.github.com/repos/changesets/changesets/git/commits/c11391bc43be1b1c1afcad15b4abb6cf8ad6e354"},"tag":"@changesets/cli@2.27.1","message":"@changesets/cli@2.27.1\\n","verification":{"verified":false,"reason":"unsigned","signature":null,"payload":null,"verified_at":null}}',
  stderr: "",
};

describe("findTag", () => {
  test("a tag gives its commit, with one GET and no progress step", async () => {
    const read = { path: "repos/acmelabs-15/brain/git/ref/tags/latest" };
    const world = fakeWorld({ spawn: [ghScripted(read, latestOfBrain)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      tagCommand,
      { owner: "acmelabs-15", name: "brain", tag: "latest" },
      caller,
    );
    expect(outcome).toEqual({
      ok: true,
      command: "sample find-tag",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: { sha: "7dee2ef38b7fadfa963ea14c76193457a2f19f91" },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([ghLogged(read)]);
  });

  test("a 404 gives null at once, with no wait", async () => {
    // acmelabs-15/cli had no latest tag on 2026-10-20 (note 09, section 2.9).
    const read = { path: "repos/acmelabs-15/cli/git/ref/tags/latest" };
    const world = fakeWorld({ spawn: [ghScripted(read, ghAnswers.notFound)] });
    const outcome = await runCommand(
      tagCommand,
      { owner: "acmelabs-15", name: "cli", tag: "latest" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: null });
    expect(world.calls).toEqual([ghLogged(read)]);
  });

  test("an annotated tag, with @ and / in its name, gives the commit that its tag object names", async () => {
    // changesets tags each release with an annotated tag; GitHub reads the encoded / whole.
    const ref = { path: "repos/changesets/changesets/git/ref/tags/%40changesets%2Fcli%402.27.1" };
    const tagObject = {
      path: "repos/changesets/changesets/git/tags/5f4a8bc561ec41be9ca7844c8cf2da99e2413e80",
    };
    const world = fakeWorld({
      spawn: [
        ghScripted(ref, annotatedRefOfChangesets),
        ghScripted(tagObject, tagObjectOfChangesets),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      tagCommand,
      { owner: "changesets", name: "changesets", tag: "@changesets/cli@2.27.1" },
      caller,
    );
    expect(outcome).toMatchObject({
      ok: true,
      exitCode: 0,
      result: { sha: "c11391bc43be1b1c1afcad15b4abb6cf8ad6e354" },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([ghLogged(ref), ghLogged(tagObject)]);
  });

  test("a tag that points at a tree ends with exit 3, naming the tag and the object's type", async () => {
    const read = { path: "repos/acmelabs-15/brain/git/ref/tags/latest" };
    const world = fakeWorld({
      spawn: [
        ghScripted(read, {
          code: 0,
          stdout: latestOfBrain.stdout.replace('"type":"commit"', '"type":"tree"'),
          stderr: "",
        }),
      ],
    });
    const outcome = await runCommand(
      tagCommand,
      { owner: "acmelabs-15", name: "brain", tag: "latest" },
      frontEnd(world),
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample find-tag",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message: "the tag latest of acmelabs-15/brain points at a tree, not a commit",
        issues: [],
      },
    });
    expect(world.calls).toEqual([ghLogged(read)]);
  });

  test("a tag and GitHub's object type show on one line in the message", async () => {
    // Built: the tag comes from the caller as given, and the type from GitHub.
    const read = { path: "repos/acmelabs-15/brain/git/ref/tags/v1%1B%5B2J" };
    const world = fakeWorld({
      spawn: [
        ghScripted(read, {
          code: 0,
          stdout: latestOfBrain.stdout.replace('"type":"commit"', String.raw`"type":"tree\r\n"`),
          stderr: "",
        }),
      ],
    });
    const outcome = await runCommand(
      tagCommand,
      { owner: "acmelabs-15", name: "brain", tag: "v1\u001B[2J" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message: "the tag v1 [2J of acmelabs-15/brain points at a tree, not a commit",
      },
    });
  });

  test("a sha that is not a commit sha ends with exit 3, and goes into no path", async () => {
    const ref = { path: "repos/changesets/changesets/git/ref/tags/v1" };
    const world = fakeWorld({
      spawn: [
        ghScripted(ref, {
          code: 0,
          stdout: annotatedRefOfChangesets.stdout.replace(
            '"sha":"5f4a8bc561ec41be9ca7844c8cf2da99e2413e80"',
            '"sha":"../../../user"',
          ),
          stderr: "",
        }),
      ],
    });
    const outcome = await runCommand(
      tagCommand,
      { owner: "changesets", name: "changesets", tag: "v1" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          'gh api GET repos/changesets/changesets/git/ref/tags/v1 gave an answer that acmelabs cannot read: object.sha: "../../../user" is not a commit sha; a sha is 40 characters, each 0 to 9 or a to f',
      },
    });
    expect(world.calls).toEqual([ghLogged(ref)]);
  });

  test.each([
    ["no characters", ""],
    [".", "."],
    ["..", ".."],
  ])("a tag of %s ends with exit 2, and makes no call", async (_case, tag) => {
    // encodeURIComponent leaves a dot as it is, so "." and ".." would move inside the API path.
    const world = fakeWorld();
    const outcome = await runCommand(
      tagCommand,
      { owner: "acmelabs-15", name: "brain", tag },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message: `${JSON.stringify(tag)} is not a tag; a tag has a name, and is not "." or ".."`,
      },
    });
    expect(world.calls).toEqual([]);
  });
});

/** A sample command that waits for a push run of a workflow file, with the step's options. */
const watchCommand = defineCommand({
  path: ["sample", "watch-run"],
  summary: "Wait for a push run of a workflow on a GitHub repo.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
    headSha: z.string().describe("The pushed commit."),
    workflow: z.string().describe("The workflow file, such as .github/workflows/release.yml."),
    pollMs: z.number().optional().describe("The wait between two polls."),
    appearWithinMs: z.number().optional().describe("How long the run may take to appear."),
    completeWithinMs: z.number().optional().describe("How long the run may take to complete."),
  }),
  run(input, context) {
    const { owner, name, ...rest } = input;
    return watchRun(context, { repo: { owner, name }, ...rest });
  },
});

/** The commit of acmelabs-15/brain that its CI and Release runs 39382027375 and 39382027513 ran on. */
const brainSha = "7dee2ef38b7fadfa963ea14c76193457a2f19f91";

/**
 * acmelabs-15/brain's CI run of commit 7dee2ef, read on 2026-10-20 under API version 2026-03-10:
 * real, with the nested repository, head_repository, head_commit, actor and triggering_actor
 * objects left out. The step reads none of them.
 */
const ciRunOfBrain =
  '{"id":39382027375,"name":"CI","node_id":"WFR_kwLORgonY88AAAAJK1oMbw","head_branch":"main","head_sha":"7dee2ef38b7fadfa963ea14c76193457a2f19f91","path":".github/workflows/ci.yml","display_title":"Merge pull request #6 from acmelabs-15/changeset-release/main","run_number":19,"event":"push","status":"completed","conclusion":"success","workflow_id":347493190,"check_suite_id":106717221952,"check_suite_node_id":"CS_kwDORgonY88AAAAY2NeUQA","url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027375","html_url":"https://github.com/acmelabs-15/brain/actions/runs/39382027375","pull_requests":[],"created_at":"2026-10-20T06:43:16Z","updated_at":"2026-10-20T06:43:32Z","run_attempt":1,"referenced_workflows":[],"run_started_at":"2026-10-20T06:43:16Z","jobs_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027375/jobs","logs_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027375/logs","check_suite_url":"https://api.github.com/repos/acmelabs-15/brain/check-suites/106717221952","artifacts_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027375/artifacts","cancel_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027375/cancel","rerun_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027375/rerun","previous_attempt_url":null,"workflow_url":"https://api.github.com/repos/acmelabs-15/brain/actions/workflows/347493190"}';

/**
 * acmelabs-15/brain's Release run of commit 7dee2ef, which succeeded, as `ciRunOfBrain` was read.
 * The runs list and a read of the run give the same fields (a probe on 2026-10-20).
 */
const releaseRunOfBrain =
  '{"id":39382027513,"name":"Release","node_id":"WFR_kwLORgonY88AAAAJK1oM-Q","head_branch":"main","head_sha":"7dee2ef38b7fadfa963ea14c76193457a2f19f91","path":".github/workflows/release.yml","display_title":"Merge pull request #6 from acmelabs-15/changeset-release/main","run_number":12,"event":"push","status":"completed","conclusion":"success","workflow_id":362189464,"check_suite_id":106717222277,"check_suite_node_id":"CS_kwDORgonY88AAAAY2NeVhQ","url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027513","html_url":"https://github.com/acmelabs-15/brain/actions/runs/39382027513","pull_requests":[],"created_at":"2026-10-20T06:43:16Z","updated_at":"2026-10-20T06:43:38Z","run_attempt":1,"referenced_workflows":[],"run_started_at":"2026-10-20T06:43:16Z","jobs_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027513/jobs","logs_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027513/logs","check_suite_url":"https://api.github.com/repos/acmelabs-15/brain/check-suites/106717222277","artifacts_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027513/artifacts","cancel_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027513/cancel","rerun_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/39382027513/rerun","previous_attempt_url":null,"workflow_url":"https://api.github.com/repos/acmelabs-15/brain/actions/workflows/362189464"}';

/**
 * acmelabs-15/brain's first Release run, of commit 7023e44 on 2026-09-19, which failed, as
 * `ciRunOfBrain` was read.
 */
const failedReleaseRunOfBrain =
  '{"id":35457136418,"name":"Release","node_id":"WFR_kwLORgonY88AAAAIQWj3Ig","head_branch":"main","head_sha":"7023e44544169f76a2de45710c51b4cfc9a86946","path":".github/workflows/release.yml","display_title":"docs: spec index, evals built, first run pending","run_number":1,"event":"push","status":"completed","conclusion":"failure","workflow_id":362189464,"check_suite_id":96018943771,"check_suite_node_id":"CS_kwDORgonY88AAAAWWyzPGw","url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/35457136418","html_url":"https://github.com/acmelabs-15/brain/actions/runs/35457136418","pull_requests":[],"created_at":"2026-09-19T17:08:14Z","updated_at":"2026-09-19T17:08:41Z","run_attempt":1,"referenced_workflows":[],"run_started_at":"2026-09-19T17:08:14Z","jobs_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/35457136418/jobs","logs_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/35457136418/logs","check_suite_url":"https://api.github.com/repos/acmelabs-15/brain/check-suites/96018943771","artifacts_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/35457136418/artifacts","cancel_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/35457136418/cancel","rerun_url":"https://api.github.com/repos/acmelabs-15/brain/actions/runs/35457136418/rerun","previous_attempt_url":null,"workflow_url":"https://api.github.com/repos/acmelabs-15/brain/actions/workflows/362189464"}';

/** Built: a run as GitHub writes it, with some fields changed, such as a status of in_progress. */
function runWith(run: string, fields: Record<string, unknown>): string {
  const read: object = JSON.parse(run);
  return JSON.stringify({ ...read, ...fields });
}

/** gh's answer to a read of one run. */
function runAnswer(run: string): Spawned {
  return { code: 0, stdout: run, stderr: "" };
}

/** gh's answer to a read of the runs list, with these runs, in the list's shape. */
function runListAnswer(runs: readonly string[]): Spawned {
  return {
    code: 0,
    stdout: `{"total_count":${runs.length},"workflow_runs":[${runs.join(",")}]}`,
    stderr: "",
  };
}

/** An empty runs list, as GitHub answered for a commit with no runs on 2026-10-20. */
const noRuns: Spawned = { code: 0, stdout: '{"total_count":0,"workflow_runs":[]}', stderr: "" };

/** The calls of the step on acmelabs-15/brain: the push runs of a commit, and one run. */
function runCalls(sha: string, id: number) {
  return {
    list: { path: `repos/acmelabs-15/brain/actions/runs?head_sha=${sha}&event=push&per_page=100` },
    run: { path: `repos/acmelabs-15/brain/actions/runs/${id}` },
  } as const;
}

/** The step of watchRun for brain's release workflow, with one status. */
function runStep(status: "started" | "done" | "failed", detail?: string): ProgressUpdate {
  const step = {
    kind: "step",
    step: "github-run",
    title: "Wait for the .github/workflows/release.yml run on acmelabs-15/brain",
    status,
  } as const;
  return detail === undefined ? step : { ...step, detail };
}

/** An info message, as the step reports a status change. */
function info(text: string): ProgressUpdate {
  return { kind: "message", level: "info", text };
}

/** The input of the sample command for brain's release workflow on a commit. */
function brainRelease(sha: string) {
  return {
    owner: "acmelabs-15",
    name: "brain",
    headSha: sha,
    workflow: ".github/workflows/release.yml",
  };
}

/** A wait between two polls, as fakeWorld logs it. */
function sleep(ms: number) {
  return { kind: "sleep", ms } as const;
}

describe("watchRun", () => {
  test("a run that appears on the second poll and succeeds gives a done step; the polls are 10 seconds apart", async () => {
    const { list, run } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [
        ghScripted(list, noRuns),
        ghScripted(
          list,
          runListAnswer([
            runWith(ciRunOfBrain, { status: "queued", conclusion: null }),
            runWith(releaseRunOfBrain, { status: "queued", conclusion: null }),
          ]),
        ),
        ghScripted(
          run,
          runAnswer(runWith(releaseRunOfBrain, { status: "in_progress", conclusion: null })),
        ),
        ghScripted(run, runAnswer(releaseRunOfBrain)),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), caller);
    expect(outcome).toEqual({
      ok: true,
      command: "sample watch-run",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: {
        id: 39_382_027_513,
        url: "https://github.com/acmelabs-15/brain/actions/runs/39382027513",
        conclusion: "success",
      },
    });
    expect(caller.updates).toEqual([
      runStep("started"),
      info("Release: queued"),
      info("Release: in_progress"),
      info("Release: completed"),
      runStep("done", "success"),
    ]);
    expect(world.calls).toEqual([
      ghLogged(list),
      sleep(10_000),
      ghLogged(list),
      sleep(10_000),
      ghLogged(run),
      sleep(10_000),
      ghLogged(run),
    ]);
    expect(world.now()).toEqual(new Date("2026-01-01T00:00:30.000Z"));
  });

  test("a run that fails gives a failed step, its conclusion in the result, and exit 0", async () => {
    // brain's first Release run, on 2026-09-19, failed: the caller decides what that means.
    const sha = "7023e44544169f76a2de45710c51b4cfc9a86946";
    const { list, run } = runCalls(sha, 35_457_136_418);
    const world = fakeWorld({
      spawn: [
        ghScripted(
          list,
          runListAnswer([
            runWith(failedReleaseRunOfBrain, { status: "in_progress", conclusion: null }),
          ]),
        ),
        ghScripted(run, runAnswer(failedReleaseRunOfBrain)),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(sha), caller);
    expect(outcome).toEqual({
      ok: true,
      command: "sample watch-run",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: {
        id: 35_457_136_418,
        url: "https://github.com/acmelabs-15/brain/actions/runs/35457136418",
        conclusion: "failure",
      },
    });
    expect(caller.updates).toEqual([
      runStep("started"),
      info("Release: in_progress"),
      info("Release: completed"),
      runStep("failed", "failure"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), sleep(10_000), ghLogged(run)]);
  });

  test("a run already completed when it appears needs no read of the run", async () => {
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [ghScripted(list, runListAnswer([ciRunOfBrain, releaseRunOfBrain]))],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), caller);
    expect(outcome).toMatchObject({
      ok: true,
      result: { id: 39_382_027_513, conclusion: "success" },
    });
    expect(caller.updates).toEqual([
      runStep("started"),
      info("Release: completed"),
      runStep("done", "success"),
    ]);
    expect(world.calls).toEqual([ghLogged(list)]);
  });

  test("GitHub's run name and conclusion show on one line in the info message and the step's detail; the result keeps the conclusion as GitHub gives it", async () => {
    // Built: a run's name comes from its workflow file, which anyone who can push may write.
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [
        ghScripted(
          list,
          runListAnswer([
            runWith(releaseRunOfBrain, { name: "Release\r\n\u001B[2J", conclusion: "fail‮ure" }),
          ]),
        ),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), caller);
    expect(outcome).toMatchObject({ ok: true, result: { conclusion: "fail‮ure" } });
    expect(caller.updates).toEqual([
      runStep("started"),
      info("Release [2J: completed"),
      runStep("failed", "fail ure"),
    ]);
  });

  test("GitHub's run name and web address show on one line when the run does not complete in time", async () => {
    // Built: a run's name comes from its workflow file, and its web address from GitHub.
    const { list, run } = runCalls(brainSha, 39_382_027_513);
    const inProgress = runWith(releaseRunOfBrain, {
      name: "Release\u001B[2J",
      status: "in_progress",
      conclusion: null,
      html_url: "https://github.com/acmelabs-15/brain/actions/runs/39382027513‮",
    });
    const world = fakeWorld({
      spawn: [
        ghScripted(list, runListAnswer([inProgress])),
        ghScripted(run, runAnswer(inProgress)),
      ],
    });
    const outcome = await runCommand(
      watchCommand,
      { ...brainRelease(brainSha), completeWithinMs: 10_000 },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "the Release [2J run of acmelabs-15/brain did not complete within 10 seconds, and goes on in GitHub: https://github.com/acmelabs-15/brain/actions/runs/39382027513",
      },
    });
  });

  test("a workflow file with a control character shows on one line when no run appears in time", async () => {
    // The workflow file comes from the caller as given.
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({ spawn: [ghScripted(list, noRuns), ghScripted(list, noRuns)] });
    const outcome = await runCommand(
      watchCommand,
      {
        ...brainRelease(brainSha),
        workflow: ".github/workflows/rel\u001B[2Jease.yml",
        appearWithinMs: 10_000,
      },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "no push run of .github/workflows/rel [2Jease.yml for commit 7dee2ef38b7fadfa963ea14c76193457a2f19f91 appeared on acmelabs-15/brain within 10 seconds; see https://github.com/acmelabs-15/brain/actions",
      },
    });
  });

  test("a workflow file with a control character shows on one line in the step's title", async () => {
    // The workflow file comes from the caller as given, and a terminal shows the step's title.
    const workflow = ".github/workflows/rel\u001B[2Jease.yml";
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [ghScripted(list, runListAnswer([runWith(releaseRunOfBrain, { path: workflow })]))],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, { ...brainRelease(brainSha), workflow }, caller);
    expect(outcome).toMatchObject({ ok: true, result: { conclusion: "success" } });
    const title = "Wait for the .github/workflows/rel [2Jease.yml run on acmelabs-15/brain";
    expect(caller.updates).toEqual([
      { kind: "step", step: "github-run", title, status: "started" },
      info("Release: completed"),
      { kind: "step", step: "github-run", title, status: "done", detail: "success" },
    ]);
  });

  test("a completed run with no conclusion gives a failed step, and null in the result", async () => {
    // GitHub types a run's conclusion as "string or null" (note 09, section 2.8).
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [ghScripted(list, runListAnswer([runWith(releaseRunOfBrain, { conclusion: null })]))],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), caller);
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: { conclusion: null } });
    expect(caller.updates).toEqual([
      runStep("started"),
      info("Release: completed"),
      runStep("failed", "no conclusion"),
    ]);
  });
});

/** The same scripted answer to a call, `count` times. */
function scriptedTimes(call: { path: string }, answer: Spawned, count: number) {
  return Array.from({ length: count }, () => ghScripted(call, answer));
}

/** fakeWorld's log of `count` polls after the first call: each a wait of `ms`, then the call. */
function pollsAfter(call: { path: string }, ms: number, count: number) {
  return Array.from({ length: count }, () => [sleep(ms), ghLogged(call)]).flat();
}

describe("watchRun: the limits", () => {
  test("a run that does not appear in 2 minutes ends with exit 3, after 13 polls 10 seconds apart", async () => {
    // Only the CI run is there: the list holds no run of the release workflow.
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({ spawn: scriptedTimes(list, runListAnswer([ciRunOfBrain]), 13) });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample watch-run",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          "no push run of .github/workflows/release.yml for commit 7dee2ef38b7fadfa963ea14c76193457a2f19f91 appeared on acmelabs-15/brain within 2 minutes; see https://github.com/acmelabs-15/brain/actions",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([runStep("started"), runStep("failed")]);
    expect(world.calls).toEqual([ghLogged(list), ...pollsAfter(list, 10_000, 12)]);
    expect(world.now()).toEqual(new Date("2026-01-01T00:02:00.000Z"));
  });

  test("a run that does not complete in 30 minutes ends with exit 3, naming the run's URL", async () => {
    const { list, run } = runCalls(brainSha, 39_382_027_513);
    const inProgress = runWith(releaseRunOfBrain, { status: "in_progress", conclusion: null });
    const world = fakeWorld({
      spawn: [
        ghScripted(list, runListAnswer([inProgress])),
        ...scriptedTimes(run, runAnswer(inProgress), 180),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample watch-run",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          "the Release run of acmelabs-15/brain did not complete within 30 minutes, and goes on in GitHub: https://github.com/acmelabs-15/brain/actions/runs/39382027513",
        issues: [],
      },
    });
    // A status that does not change gives no second message.
    expect(caller.updates).toEqual([
      runStep("started"),
      info("Release: in_progress"),
      runStep("failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), ...pollsAfter(run, 10_000, 180)]);
    expect(world.now()).toEqual(new Date("2026-01-01T00:30:00.000Z"));
  });

  test("the options change the wait between polls and the time to appear; the last poll comes at the limit", async () => {
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({ spawn: scriptedTimes(list, noRuns, 4) });
    const outcome = await runCommand(
      watchCommand,
      { ...brainRelease(brainSha), pollMs: 5000, appearWithinMs: 12_000 },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "no push run of .github/workflows/release.yml for commit 7dee2ef38b7fadfa963ea14c76193457a2f19f91 appeared on acmelabs-15/brain within 12 seconds; see https://github.com/acmelabs-15/brain/actions",
      },
    });
    // Polls at 0, 5, 10 and 12 seconds: the deadline comes before a third whole wait.
    expect(world.calls).toEqual([
      ghLogged(list),
      sleep(5000),
      ghLogged(list),
      sleep(5000),
      ghLogged(list),
      sleep(2000),
      ghLogged(list),
    ]);
    expect(world.now()).toEqual(new Date("2026-01-01T00:00:12.000Z"));
  });

  test("the options change the wait between polls and the time to complete, counted from when the run appears", async () => {
    const { list, run } = runCalls(brainSha, 39_382_027_513);
    const queued = runWith(releaseRunOfBrain, { status: "queued", conclusion: null });
    const world = fakeWorld({
      spawn: [
        ghScripted(list, noRuns),
        ghScripted(list, runListAnswer([queued])),
        ...scriptedTimes(run, runAnswer(queued), 4),
      ],
    });
    const outcome = await runCommand(
      watchCommand,
      { ...brainRelease(brainSha), pollMs: 5000, completeWithinMs: 20_000 },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "the Release run of acmelabs-15/brain did not complete within 20 seconds, and goes on in GitHub: https://github.com/acmelabs-15/brain/actions/runs/39382027513",
      },
    });
    // The run appears at 5 seconds; its reads come at 10, 15, 20 and 25 seconds.
    expect(world.calls).toEqual([
      ghLogged(list),
      sleep(5000),
      ghLogged(list),
      ...pollsAfter(run, 5000, 4),
    ]);
    expect(world.now()).toEqual(new Date("2026-01-01T00:00:25.000Z"));
  });

  test("a run that completes on the last poll, at the limit, gives a done step", async () => {
    const { list, run } = runCalls(brainSha, 39_382_027_513);
    const inProgress = runWith(releaseRunOfBrain, { status: "in_progress", conclusion: null });
    const world = fakeWorld({
      spawn: [
        ghScripted(list, runListAnswer([inProgress])),
        ...scriptedTimes(run, runAnswer(inProgress), 2),
        ghScripted(run, runAnswer(releaseRunOfBrain)),
      ],
    });
    const outcome = await runCommand(
      watchCommand,
      { ...brainRelease(brainSha), pollMs: 5000, completeWithinMs: 12_000 },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: { conclusion: "success" } });
    // Reads at 5, 10 and 12 seconds: the last one comes at the limit, and the run has completed.
    expect(world.calls).toEqual([
      ghLogged(list),
      sleep(5000),
      ghLogged(run),
      sleep(5000),
      ghLogged(run),
      sleep(2000),
      ghLogged(run),
    ]);
  });

  test("an option given as undefined keeps its default", async () => {
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [ghScripted(list, noRuns), ghScripted(list, runListAnswer([releaseRunOfBrain]))],
    });
    const outcome = await runCommand(
      watchCommand,
      { ...brainRelease(brainSha), pollMs: undefined, appearWithinMs: undefined },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: { conclusion: "success" } });
    expect(world.calls).toEqual([ghLogged(list), sleep(10_000), ghLogged(list)]);
  });

  test.each([
    ["pollMs", 0],
    ["appearWithinMs", -1],
    ["completeWithinMs", 0],
  ])("%s of %d is a bug in the caller: exit 70, before any call", async (option, ms) => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(
      watchCommand,
      { ...brainRelease(brainSha), [option]: ms },
      caller,
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 70,
      error: {
        kind: "bug",
        message: expect.stringContaining(
          `watchRun's ${option} is a positive number of milliseconds, not ${ms}`,
        ),
      },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });
});

describe("watchRun: the commit and the runs", () => {
  test.each([
    ["7 characters", "7dee2ef"],
    ["41 characters", `${brainSha}0`],
    ["capital letters", brainSha.toUpperCase()],
    ["a second query field", `${brainSha.slice(0, 26)}&event=schedule`],
    ["no characters", ""],
  ])("a commit sha with %s ends with exit 2, and makes no call", async (_case, sha) => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(watchCommand, brainRelease(sha), caller);
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message: `${JSON.stringify(sha)} is not a commit sha; a sha is 40 lowercase hex characters, as git rev-parse prints it`,
      },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("of several runs of the workflow on one commit, the step follows the newest; of two at the same second, the higher id", async () => {
    // Built: three runs of release.yml on one commit, as a second push of the commit would give.
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [
        ghScripted(
          list,
          runListAnswer([
            runWith(releaseRunOfBrain, { id: 39_382_090_001, created_at: "2026-10-20T06:50:00Z" }),
            runWith(releaseRunOfBrain, {
              id: 39_382_090_002,
              created_at: "2026-10-20T06:50:00Z",
              conclusion: "failure",
              html_url: "https://github.com/acmelabs-15/brain/actions/runs/39382090002",
            }),
            releaseRunOfBrain,
          ]),
        ),
      ],
    });
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), frontEnd(world));
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        id: 39_382_090_002,
        url: "https://github.com/acmelabs-15/brain/actions/runs/39382090002",
        conclusion: "failure",
      },
    });
    expect(world.calls).toEqual([ghLogged(list)]);
  });

  test("a run of another shape ends with exit 3, naming the call", async () => {
    const { list } = runCalls(brainSha, 39_382_027_513);
    const world = fakeWorld({
      spawn: [ghScripted(list, runListAnswer([runWith(releaseRunOfBrain, { id: "1/../2" })]))],
    });
    const outcome = await runCommand(watchCommand, brainRelease(brainSha), frontEnd(world));
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message: `gh api GET repos/acmelabs-15/brain/actions/runs?head_sha=${brainSha}&event=push&per_page=100 gave an answer that acmelabs cannot read: workflow_runs[0].id: Invalid input: expected number, received string`,
      },
    });
    expect(world.calls).toEqual([ghLogged(list)]);
  });
});
