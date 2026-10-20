import { z } from "zod";

import type { CommandError } from "../command/outcome";
import { inputError } from "../command/outcome";
import type { GhAnswer, StepContext } from "./gh";
import { ghApi, readBody, repoPath } from "./gh";
import { commitShaSchema, inLocalHistory } from "./git";
import type { GitHubRepo } from "./names";
import { fullName } from "./names";

/**
 * A repo's visibility on GitHub, as a run asks for it. acmelabs never changes a repo's visibility.
 */
export type Visibility = "public" | "private";

/** What `ensureRepo` takes. */
export type RepoRequest = {
  /** The repo, in an organization such as acmelabs-15. */
  repo: GitHubRepo;
  /** The visibility of a new repo, and the one an existing repo must have to be reused. */
  visibility: Visibility;
  /** A new repo's description; with none, GitHub's default, no description. */
  description?: string;
  /**
   * The folder of the local git repo that this run pushes: an existing repo whose main commit is
   * in its history is this run's repo.
   */
  localRoot: string;
};

/** What `ensureRepo` gives: the repo's page, its HTTPS clone URL, and whether the step made it. */
export type EnsuredRepo = { url: string; cloneUrl: string; made: "created" | "reused" };

/**
 * GitHub's answer to a read or a create of a repo: the fields the step reads (note 09, section
 * 2.3). `visibility` is text, not the two that a run asks for: GitHub also has "internal".
 */
const repoBody = z.object({
  html_url: z.string(),
  clone_url: z.string(),
  visibility: z.string(),
  default_branch: z.string(),
});

/** A repo as the step reads it from GitHub's answer. */
type FoundRepo = z.output<typeof repoBody>;

/**
 * GitHub's answer to a read of a branch's ref: the commit the branch is at. The sha goes into a
 * git command line, so it passes the sha check here: another shape is an answer the step cannot
 * read.
 */
const refBody = z.object({ object: z.object({ sha: commitShaSchema }) });

/** GitHub's message when it answers a ref read of an empty repo with 409 (note 09, section 2.9). */
const emptyRepoMessage = /^Git Repository is empty\b/u;

/**
 * The input failure for an existing repo that holds work which is not this run's. It names the
 * repo and says why, and that acmelabs changes nothing in it.
 */
function otherWork(repo: GitHubRepo, why: string): CommandError {
  return inputError(
    `${fullName(repo)} already exists on GitHub and holds other work: ${why}; acmelabs changes nothing in ${fullName(repo)}, so pick another name`,
  );
}

/**
 * The input failure for an existing repo with another visibility than the run asks for. It names
 * both, and says that acmelabs never changes a repo's visibility: private to public makes the
 * Actions logs public, and either way erases the stars (note 09, section 2.4).
 */
function otherVisibility(repo: GitHubRepo, found: string, asked: Visibility): CommandError {
  return inputError(
    `${fullName(repo)} already exists on GitHub as a ${found} repo, and this run asks for a ${asked} one; acmelabs never changes a repo's visibility, and changes nothing in ${fullName(repo)}, so pick another name, or ask for a ${found} repo`,
  );
}

/**
 * Whether GitHub answered 404 to the call, and gh names no scope that the gh login lacks: then
 * nothing is there for the login. A 404 for which gh names a scope goes to the table, as a login
 * failure.
 */
function notFound(answer: GhAnswer): boolean {
  return !answer.ok && answer.status === 404 && answer.missingScope === undefined;
}

/**
 * Creates the repo in its organization with the name, the description and the visibility, and
 * GitHub's defaults for every other field. A POST is never sent twice (see `ghApi`). A 404 means
 * that GitHub finds no organization of that owner in which the gh login may create a repo: an
 * input failure, exit 2, that names the owner. The table's 404 on a write names the repo's access
 * instead, so the step reads this 404 itself: only the step knows that the call creates in an
 * organization.
 */
async function createRepo(
  context: StepContext,
  { repo, visibility, description }: RepoRequest,
): Promise<FoundRepo> {
  // The owner passed its name check in repoPath before the step started, so it goes in as it is.
  const path = `orgs/${repo.owner}/repos`;
  // JSON leaves out a description that is undefined, so GitHub's default holds.
  const created = await ghApi(context, {
    method: "POST",
    path,
    body: { name: repo.name, description, visibility },
  });
  if (notFound(created)) {
    throw inputError(
      `GitHub found no organization ${repo.owner} in which the gh login may create ${fullName(repo)} (HTTP 404 on POST ${path}); check the owner, and that the login is a member of the organization`,
    );
  }
  return readBody(created, repo, repoBody);
}

/**
 * The reason to reuse an existing repo, for the skipped step, when it is this run's repo. It
 * checks, in order: the visibility the run asks for; then the default branch, which is either
 * missing from an empty repo (GitHub's 409) or at a commit in the local history. Anything else is
 * an input failure, exit 2, before any write.
 */
async function reuseReason(
  context: StepContext,
  { repo, visibility, localRoot }: RepoRequest,
  found: FoundRepo,
): Promise<string> {
  if (found.visibility !== visibility) {
    throw otherVisibility(repo, found.visibility, visibility);
  }
  const branch = found.default_branch;
  // A 409 is the step's own answer, an empty repo, so it comes back at once. A 404 is tried again
  // first: right after a create, GitHub can give it for a few seconds (note 09, section 3.1).
  const ref = await ghApi(context, {
    path: repoPath(repo, `git/ref/heads/${encodeURIComponent(branch)}`),
    expected: [409],
  });
  if (!ref.ok && ref.status === 409 && emptyRepoMessage.test(ref.message)) {
    return "already there, and empty";
  }
  // GitHub answers 409 for every ref of an empty repo, so this repo has commits.
  if (notFound(ref)) {
    throw otherWork(repo, `it is not empty, and GitHub finds no ${branch} branch in it`);
  }
  const { sha } = readBody(ref, repo, refBody).object;
  if (await inLocalHistory(context, { sha, localRoot })) {
    return "already there, at a commit in the local history";
  }
  throw otherWork(
    repo,
    `its ${branch} branch is at ${sha}, a commit that is not in the local history of ${localRoot}`,
  );
}

/**
 * Creates the repo, or reuses it when it is this run's repo, by Peter's re-run rule. It reads the
 * repo first: on a 404 it creates it in the organization with the name, the description and the
 * visibility, and the step is done. An existing repo is reused, and the step skipped, only when it
 * has the asked visibility and is empty or has its main commit in the local history at
 * `localRoot`; any other existing repo is an input failure, exit 2, and gets no write.
 */
export async function ensureRepo(context: StepContext, request: RepoRequest): Promise<EnsuredRepo> {
  const { repo } = request;
  // The names pass their check before the step starts, so no title shows a name that fails it.
  const path = repoPath(repo);
  const step = {
    kind: "step",
    step: "github-repo",
    title: `Create the GitHub repo ${fullName(repo)}`,
  } as const;
  context.progress({ ...step, status: "started" });
  // A 404 is the step's own answer, no repo of that name, so it comes back at once.
  const read = await ghApi(context, { path, expected: [404] });
  if (notFound(read)) {
    const created = await createRepo(context, request);
    context.progress({ ...step, status: "done" });
    return { url: created.html_url, cloneUrl: created.clone_url, made: "created" };
  }
  const found = readBody(read, repo, repoBody);
  const reason = await reuseReason(context, request, found);
  context.progress({ ...step, status: "skipped", detail: reason });
  return { url: found.html_url, cloneUrl: found.clone_url, made: "reused" };
}
