import { z } from "zod";

import type { ProgressUpdate } from "../command/command";
import { inputError, outsideError } from "../command/outcome";
import { durationOf } from "../command/words";
import type { StepContext } from "./gh";
import { ghApi, readBody, repoPath, shownText, startStep } from "./gh";
import { commitShaSchema } from "./git";
import type { GitHubRepo } from "./names";
import { fullName, quoted } from "./names";

/**
 * One workflow run, as the runs list and a read of the run give it: the fields that the step reads
 * (note 09, section 2.8). The id goes into an API path, so it is a positive whole number. GitHub
 * gives no conclusion until the run completes.
 */
const runBody = z.object({
  id: z.int().positive(),
  name: z.string(),
  path: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  created_at: z.iso.datetime(),
});

/** One workflow run's fields that the step reads. */
type Run = z.output<typeof runBody>;

/**
 * The newest of the runs: the latest `created_at`, and of two at the same second, the higher id.
 * One commit can have several push runs of one workflow, when the commit is pushed to a second
 * branch, say; the newest is the one the latest push started. A re-run keeps its run's id, so it
 * is no second run. The runs list can be up to 60 seconds old, so for a commit pushed twice the
 * step can follow the older run when the newer one is not listed yet. Undefined for no runs.
 */
function newestRun(runs: readonly Run[]): Run | undefined {
  return runs.toSorted(
    (one, other) => Date.parse(other.created_at) - Date.parse(one.created_at) || other.id - one.id,
  )[0];
}

/** GitHub's answer to a read of the runs list: one page of runs. */
const runListBody = z.object({ workflow_runs: z.array(runBody) });

/** How a run ended: its id, its page on GitHub, and its conclusion, such as success or failure. */
export type RunEnd = { id: number; url: string; conclusion: string | null };

/**
 * How watchRun polls, by the spec's "Agent's calls for `watchRun`": one poll every 10 seconds, and
 * the run must appear within 2 minutes and complete within 30 minutes. A poll costs one GET, so a
 * wait of 30 minutes costs 180 of the 5,000 requests an hour. The runs list may be up to 60 seconds
 * old (`Cache-Control: max-age=60`, note 09, section 2.8), and 2 minutes covers that.
 */
export const runWaits = {
  /** The wait between two polls: 10 seconds. */
  pollMs: 10 * 1000,
  /** How long the run may take to appear in the runs list after the step starts: 2 minutes. */
  appearWithinMs: 2 * 60 * 1000,
  /** How long the run may take to complete after it appears: 30 minutes. */
  completeWithinMs: 30 * 60 * 1000,
} as const;

/** How watchRun polls: each wait in milliseconds, as `runWaits` names them. */
export type RunWaits = { pollMs: number; appearWithinMs: number; completeWithinMs: number };

/**
 * What watchRun waits for: a push run of the workflow file, such as release.yml, on a commit. Each
 * wait that the call leaves out is the one in `runWaits`.
 */
export type RunWatch = {
  repo: GitHubRepo;
  /** The pushed commit, 40 lowercase hex characters. */
  headSha: string;
  /** The workflow file's path in the repo, such as `.github/workflows/release.yml`. */
  workflow: string;
} & Partial<RunWaits>;

/**
 * The call's waits, each one the call leaves out, or gives as undefined, from `runWaits`. A wait
 * that is not a positive, finite number of milliseconds is a bug in the caller, so it throws a
 * plain Error: a poll's wait of 0 would poll GitHub with no pause.
 */
function checkedWaits(watch: RunWatch): RunWaits {
  const waits = {
    pollMs: watch.pollMs ?? runWaits.pollMs,
    appearWithinMs: watch.appearWithinMs ?? runWaits.appearWithinMs,
    completeWithinMs: watch.completeWithinMs ?? runWaits.completeWithinMs,
  };
  for (const [name, ms] of Object.entries(waits)) {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error(`watchRun's ${name} is a positive number of milliseconds, not ${ms}`);
    }
  }
  return waits;
}

/**
 * The pushed commit's sha, checked: it goes into the runs list's query, so it is 40 lowercase hex
 * characters, as git rev-parse prints it. Any other text is an input failure, exit 2, before any
 * call.
 */
function checkedSha(headSha: string): string {
  if (!commitShaSchema.safeParse(headSha).success) {
    throw inputError(
      `${quoted(headSha)} is not a commit sha; a sha is 40 lowercase hex characters, as git rev-parse prints it`,
    );
  }
  return headSha;
}

/**
 * The info message for a run's new status, such as `Release: in_progress`. GitHub's two texts show
 * as `shownText` gives them: a run's name comes from its workflow file.
 */
function statusMessage(run: Run): ProgressUpdate {
  return {
    kind: "message",
    level: "info",
    text: `${shownText(run.name)}: ${shownText(run.status)}`,
  };
}

/**
 * The wait before the next poll: a poll's wait, or the time left before the deadline when that is
 * shorter, so the last poll comes at the deadline. Undefined once the deadline has come. The time
 * comes from `context.now()`, which a fake World's sleep moves.
 */
function nextWaitMs(context: StepContext, deadline: number, pollMs: number): number | undefined {
  const left = deadline - context.now().getTime();
  return left > 0 ? Math.min(pollMs, left) : undefined;
}

/** The repo's Actions page, which lists its runs. */
function actionsPage(repo: GitHubRepo): string {
  return `https://github.com/${fullName(repo)}/actions`;
}

/**
 * Polls the push runs of the commit, at `path`, until a run of the workflow file is among them,
 * and gives the newest. A run that has not appeared by the deadline is an outside failure, exit 3,
 * that names the Actions page.
 */
async function appearedRun(
  context: StepContext,
  watch: RunWatch,
  path: string,
  waits: RunWaits,
): Promise<Run> {
  const { repo, headSha, workflow } = watch;
  const deadline = context.now().getTime() + waits.appearWithinMs;
  for (;;) {
    const list = readBody(await ghApi(context, { path }), repo, runListBody);
    const run = newestRun(list.workflow_runs.filter((listed) => listed.path === workflow));
    if (run !== undefined) {
      return run;
    }
    const waitMs = nextWaitMs(context, deadline, waits.pollMs);
    if (waitMs === undefined) {
      throw outsideError(
        `no push run of ${shownText(workflow)} for commit ${headSha} appeared on ${fullName(repo)} within ${durationOf(waits.appearWithinMs)}; see ${actionsPage(repo)}`,
      );
    }
    await context.sleep(waitMs);
  }
}

/**
 * Polls the run until its status is `completed`, and reports each status change. A run that has
 * not completed by the deadline is an outside failure, exit 3, that names the run's page: the run
 * goes on in GitHub.
 */
async function completedRun(
  context: StepContext,
  repo: GitHubRepo,
  appeared: Run,
  waits: RunWaits,
): Promise<Run> {
  const path = repoPath(repo, `actions/runs/${appeared.id}`);
  const deadline = context.now().getTime() + waits.completeWithinMs;
  let run = appeared;
  while (run.status !== "completed") {
    const waitMs = nextWaitMs(context, deadline, waits.pollMs);
    if (waitMs === undefined) {
      throw outsideError(
        `the ${shownText(run.name)} run of ${fullName(repo)} did not complete within ${durationOf(waits.completeWithinMs)}, and goes on in GitHub: ${shownText(run.html_url)}`,
      );
    }
    await context.sleep(waitMs);
    const polled = readBody(await ghApi(context, { path }), repo, runBody);
    if (polled.status !== run.status) {
      context.progress(statusMessage(polled));
    }
    run = polled;
  }
  return run;
}

/**
 * Waits for the push run of a workflow file on a commit, then polls that run until it completes.
 * It reports the run's status as an info message when the run appears, then each change of the
 * status. The step ends as done for the conclusion
 * `success` and as failed for any other, and returns the conclusion in either case: the caller
 * decides what a failed run means. Each wait goes through `context.sleep`, so a cancel stops it.
 * The title, the messages and the detail show the workflow file and GitHub's texts as `shownText`
 * gives them; the result keeps GitHub's conclusion as it is.
 */
export async function watchRun(context: StepContext, watch: RunWatch): Promise<RunEnd> {
  const { repo, headSha, workflow } = watch;
  // The waits, the owner and repo names (in repoPath) and the sha pass their checks before the
  // step starts, so a call that fails one ends with no progress step and no call.
  const waits = checkedWaits(watch);
  const listPath = repoPath(
    repo,
    `actions/runs?head_sha=${checkedSha(headSha)}&event=push&per_page=100`,
  );
  const title = `Wait for the ${shownText(workflow)} run on ${fullName(repo)}`;
  const end = startStep(context, "github-run", title);
  const appeared = await appearedRun(context, watch, listPath, waits);
  context.progress(statusMessage(appeared));
  const run = await completedRun(context, repo, appeared, waits);
  const status = run.conclusion === "success" ? "done" : "failed";
  end(status, run.conclusion === null ? "no conclusion" : shownText(run.conclusion));
  return { id: run.id, url: run.html_url, conclusion: run.conclusion };
}

/**
 * The object that a ref or a tag object points at: its sha and its type, such as commit or tag.
 * The sha of a tag object goes into an API path, so it passes the sha check.
 */
const pointedAt = z.object({ object: z.object({ sha: commitShaSchema, type: z.string() }) });

/**
 * A tag's name as it goes into an API path, encoded. `encodeURIComponent` leaves a dot as it is, so
 * an empty tag, "." and ".." are an input failure, exit 2, before any call: each would move inside
 * the path. So is a tag with a lone surrogate (one half of a UTF-16 pair), which
 * `encodeURIComponent` cannot encode.
 */
function tagInPath(tag: string): string {
  if (tag === "" || tag === "." || tag === ".." || /\p{Cs}/u.test(tag)) {
    throw inputError(`${quoted(tag)} is not a tag; a tag has a name, and is not "." or ".."`);
  }
  return encodeURIComponent(tag);
}

/**
 * Reads a tag of the repo, such as `latest`: the commit it names, or null when GitHub answers 404
 * because the repo has no such tag. A lightweight tag, as brain's release flow moves `latest`,
 * points at its commit (note 09, section 2.9). An annotated tag, as changesets makes for a release,
 * points at a tag object, which names the commit: the step reads each tag object until it reaches
 * the commit. git names an object by its content, so no tag object can lead back to itself. A tag
 * that ends at a tree or a blob is an outside failure, exit 3. A read, so it reports no progress
 * step.
 */
export async function findTag(
  context: StepContext,
  repo: GitHubRepo,
  tag: string,
): Promise<{ sha: string } | null> {
  const answer = await ghApi(context, {
    path: repoPath(repo, `git/ref/tags/${tagInPath(tag)}`),
    expected: [404],
  });
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  let { object } = readBody(answer, repo, pointedAt);
  while (object.type === "tag") {
    const tagObject = await ghApi(context, { path: repoPath(repo, `git/tags/${object.sha}`) });
    ({ object } = readBody(tagObject, repo, pointedAt));
  }
  if (object.type !== "commit") {
    throw outsideError(
      `the tag ${shownText(tag)} of ${fullName(repo)} points at a ${shownText(object.type)}, not a commit`,
    );
  }
  return { sha: object.sha };
}
