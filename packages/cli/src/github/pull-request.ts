import { z } from "zod";

import { inputError, outsideError } from "../command/outcome";
import type { GhAnswer, StepContext } from "./gh";
import { ghApi, readBody, repoPath } from "./gh";
import type { GitHubRepo } from "./names";
import { fullName } from "./names";

/**
 * A pull request that openPullRequest opens: the repo, the head branch with the changes, the base
 * branch they go into, and the title and the body (the description) that GitHub shows. The head
 * is a branch of the same repo.
 */
export type NewPullRequest = {
  repo: GitHubRepo;
  head: string;
  base: string;
  title: string;
  body: string;
};

/**
 * The pull request that openPullRequest reused or opened: its number, its web address, and
 * whether the step opened it ("created") or found it open already ("reused").
 */
export type PullRequest = { number: number; url: string; made: "created" | "reused" };

/**
 * A branch name, the head or the base: at least one character, and no control character or
 * colon. Git refuses both in a branch name (git check-ref-format). A colon in the head would name
 * another owner's branch, because GitHub reads a head as `owner:branch`, and the head is a branch
 * of the same repo. A control character is a mistake, and the head goes into the step's title,
 * which a terminal shows. The name is not a path segment: the query encodes it, and the body
 * carries it as JSON.
 */
const branchSchema = z.string().regex(/^[^\p{Cc}:]+$/u, {
  error: (issue) =>
    `${JSON.stringify(issue.input)} is not a branch name; a branch name has at least one character, and no control character or colon`,
});

/** The two branches of a pull request, each with the branch check. */
const branchesSchema = z.object({ head: branchSchema, base: branchSchema });

/**
 * Checks the head and the base before any call: a name that fails is an input failure, exit 2,
 * with one issue for each branch that fails.
 */
function checkBranches(head: string, base: string): void {
  const checked = branchesSchema.safeParse({ head, base });
  if (!checked.success) {
    throw inputError(
      "the pull request's head or base is not a branch name",
      checked.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
}

/**
 * The repo's pull requests as GitHub lists them: each one's number, web address, head branch and
 * head repo, and base branch. GitHub gives a null head repo when the head's repo is gone, as for a
 * deleted fork.
 */
const listBody = z.array(
  z.object({
    number: z.int().positive(),
    html_url: z.string(),
    head: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
    base: z.object({ ref: z.string() }),
  }),
);

/** One pull request of the list. */
type Listed = z.output<typeof listBody>[number];

/** GitHub's answer to the POST: the new pull request's number and web address. */
const createdBody = z.object({ number: z.int().positive(), html_url: z.string() });

/**
 * Whether a listed pull request is from the head of this repo into the base. GitHub's names do
 * not tell upper case from lower case; branch names do.
 */
function fromHeadIntoBase(listed: Listed, asked: NewPullRequest): boolean {
  return (
    listed.head.ref === asked.head &&
    listed.base.ref === asked.base &&
    listed.head.repo?.full_name.toLowerCase() === fullName(asked.repo).toLowerCase()
  );
}

/**
 * The open pull request from the head into the base, or undefined for none. GitHub opens at most
 * one pull request for a head and a base, so one page of 100 holds it. GitHub ignores a head
 * filter that it cannot read and lists every pull request (probed on 2026-10-20: a head with no
 * owner), so the step checks each listed one's head and base itself.
 */
async function openFromHead(
  context: StepContext,
  asked: NewPullRequest,
): Promise<Listed | undefined> {
  // The value of each parameter is encoded, so a branch with "/", "#", "&" or "+" reaches GitHub
  // whole: unencoded, a "#" would end the query, and a "&" would start another parameter.
  const head = encodeURIComponent(`${asked.repo.owner}:${asked.head}`);
  const base = encodeURIComponent(asked.base);
  const path = repoPath(asked.repo, `pulls?head=${head}&base=${base}&state=open&per_page=100`);
  const listed = readBody(await ghApi(context, { path }), asked.repo, listBody);
  return listed.find((pullRequest) => fromHeadIntoBase(pullRequest, asked));
}

/** GitHub's 422 errors, each with its message. */
const validationErrors = z.object({
  errors: z.array(z.object({ message: z.string() }).partial()),
});

/**
 * GitHub's message when its 422 to the POST says that a pull request from the head into the base
 * is open already: "A pull request already exists for <owner>:<branch>." (note 09, section 2.7).
 * Undefined for any other answer.
 */
function alreadyExistsMessage(answer: GhAnswer): string | undefined {
  if (answer.ok || answer.status !== 422) {
    return undefined;
  }
  const read = validationErrors.safeParse(answer.body);
  const errors = read.success ? read.data.errors : [];
  return errors.find((error) => error.message?.startsWith("A pull request already exists"))
    ?.message;
}

/**
 * Opens a pull request from the head into the base, or reuses the open one. It reads the open pull
 * requests from the head into the base first, and reports the step as skipped when one is open.
 * With none, a POST opens it; a POST is never sent twice. When GitHub answers the POST that one is
 * open already, another run opened it between the read and the POST: the step reads the list
 * again and reuses it. When the list still has none, the step ends with exit 3.
 */
export async function openPullRequest(
  context: StepContext,
  asked: NewPullRequest,
): Promise<PullRequest> {
  const { repo, head, base, title, body } = asked;
  // The names and the branches pass their checks before the step starts, so no title shows one
  // that fails.
  const path = repoPath(repo, "pulls");
  checkBranches(head, base);
  const step = {
    kind: "step",
    step: "github-pull-request",
    title: `Open a pull request from ${head} into ${base} on ${fullName(repo)}`,
  } as const;
  context.progress({ ...step, status: "started" });
  let found = await openFromHead(context, asked);
  if (found === undefined) {
    const created = await ghApi(context, {
      method: "POST",
      path,
      body: { title, head, base, body },
    });
    const alreadyOpen = alreadyExistsMessage(created);
    if (alreadyOpen === undefined) {
      const opened = readBody(created, repo, createdBody);
      context.progress({ ...step, status: "done", detail: opened.html_url });
      return { number: opened.number, url: opened.html_url, made: "created" };
    }
    found = await openFromHead(context, asked);
    if (found === undefined) {
      throw outsideError(
        `GitHub answered ${created.method} ${created.path} with HTTP 422: ${alreadyOpen} But GitHub lists no open pull request from ${head} into ${base} on ${fullName(repo)}; wait, then run the command again`,
      );
    }
  }
  context.progress({ ...step, status: "skipped", detail: `already open: ${found.html_url}` });
  return { number: found.number, url: found.html_url, made: "reused" };
}
