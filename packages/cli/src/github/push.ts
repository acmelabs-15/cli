import { lstat } from "node:fs/promises";

import { inputError } from "../command/outcome";
import type { StepContext } from "./gh";
import { shownText } from "./gh";
import type { CloneRequest, OriginUrl, RemoteBranchRequest } from "./git";
import {
  addOrigin,
  branchNameSchema,
  cloneRepo,
  httpsUrl,
  localCommit,
  originUrls,
  pushBranch,
  remoteCommit,
} from "./git";
import { fullName } from "./names";

/** What `push` takes: the repo, the folder of the local git repo, and the branch to push. */
export type PushRequest = RemoteBranchRequest;

/**
 * What `push` gives: the commit of the local branch, and whether the step pushed it; false when
 * GitHub's branch was at that commit already.
 */
export type Pushed = { sha: string; pushed: boolean };

/**
 * Checks the branch before any call: a branch name that git does not allow is an input failure,
 * exit 2, with one issue that says why.
 */
function checkBranch(branch: string): void {
  const checked = branchNameSchema.safeParse(branch);
  if (!checked.success) {
    throw inputError(
      "the branch to push is not a branch name that git allows",
      checked.error.issues.map((issue) => ({ field: "branch", message: issue.message })),
    );
  }
}

/**
 * A URL of the remote origin as a message shows it: a URL such as
 * `https://x-access-token:<token>@github.com/...` without its login part, so no token reaches the
 * output; other text as it is, such as `git@github.com:owner/name.git`, whose login GitHub always
 * reads as git. Either goes through `shownText`, as the git config's text can hold a line break. A
 * push URL says so.
 */
function shownUrl({ key, value }: OriginUrl): string {
  let shown = value;
  if (URL.canParse(value)) {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
      shown = url.href;
    }
  }
  const text = shownText(shown);
  return key === "pushurl" ? `${text} (push URL)` : text;
}

/**
 * Makes sure that the remote origin of the local repo is the repo's HTTPS URL, and only that URL:
 * it adds origin when the local repo has none. A push URL, which a push uses instead of the URL,
 * must be that URL too, or absent. Any other origin is an input failure, exit 2, that names the
 * folder and the URLs, before any call reaches a remote: a push through it would go elsewhere, or
 * not with gh's login.
 */
async function ensureOrigin(context: StepContext, { repo, cwd }: PushRequest): Promise<void> {
  const url = httpsUrl(repo);
  const found = await originUrls(context, cwd);
  if (found.length === 0) {
    await addOrigin(context, { repo, cwd });
    return;
  }
  const urls = found.filter(({ key }) => key === "url");
  if (urls.length !== 1 || found.some(({ value }) => value !== url)) {
    throw inputError(
      `the remote origin of ${shownText(cwd)} is ${found.map(shownUrl).join(", ")}, not ${url}; acmelabs pushes ${fullName(repo)} only to its HTTPS URL, so point origin at that URL, or push from another folder`,
    );
  }
}

/**
 * Pushes the local branch to the repo on GitHub, through the remote origin and gh's login. It adds
 * origin when the local repo has none, reads GitHub's branch with `git ls-remote`, and reports the
 * step as skipped when that branch is at the local commit already. Else it pushes, and sets
 * origin's branch as the upstream. A push is never forced. The messages show the folder, a URL
 * from the git config and git's commit as `shownText` gives them.
 */
export async function push(context: StepContext, request: PushRequest): Promise<Pushed> {
  const { repo, cwd, branch } = request;
  // The names and the branch pass their checks before the step starts, so no title shows one that
  // fails.
  httpsUrl(repo);
  checkBranch(branch);
  const step = {
    kind: "step",
    step: "github-push",
    title: `Push ${branch} to ${fullName(repo)}`,
  } as const;
  context.progress({ ...step, status: "started" });
  const sha = await localCommit(context, { cwd, branch });
  if (sha === undefined) {
    throw inputError(`${shownText(cwd)} has no branch ${branch} to push`);
  }
  await ensureOrigin(context, request);
  if ((await remoteCommit(context, request)) === sha) {
    context.progress({ ...step, status: "skipped", detail: `already at ${shownText(sha)}` });
    return { sha, pushed: false };
  }
  await pushBranch(context, request);
  context.progress({ ...step, status: "done" });
  return { sha, pushed: true };
}

/** What `clone` gives: the folder that holds the clone. */
export type Cloned = { into: string };

/** Whether a file system error says that nothing is at the path. */
function nothingThere(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Checks that nothing is at `into` yet, with no git call: a folder, a file or a link there is an
 * input failure, exit 2, that names it, and so is a path that cannot be a new folder, such as one
 * under a file. lstat sees a link that points nowhere too. Bun.file's `exists` is no help here: it
 * is false for a folder (probe, Bun 1.4.0).
 */
async function checkNewFolder({ repo, into }: CloneRequest): Promise<void> {
  try {
    await lstat(into);
  } catch (error) {
    if (nothingThere(error)) {
      return;
    }
    const why = error instanceof Error ? error.message : String(error);
    throw inputError(
      `acmelabs cannot clone ${fullName(repo)} into ${shownText(into)}: ${shownText(why)}`,
    );
  }
  throw inputError(
    `${shownText(into)} already exists; acmelabs clones ${fullName(repo)} only into a new folder, so name a folder that does not exist yet`,
  );
}

/**
 * Clones the repo from its HTTPS URL into a new folder, through gh's login. The folder must not
 * exist yet: an existing one is an input failure, exit 2, before any git call, and so is a folder
 * with no name. A relative folder is relative to the working folder, for the check and for git
 * alike. git gets the folder as given; the step's title and its messages show it as `shownText`
 * gives it, so a control character in it cannot reach the terminal.
 */
export async function clone(context: StepContext, request: CloneRequest): Promise<Cloned> {
  const { repo, into } = request;
  // The names and the folder pass their checks before the step starts, so no title shows one that
  // fails.
  httpsUrl(repo);
  if (into === "") {
    throw inputError(`the folder to clone ${fullName(repo)} into has no name`);
  }
  const step = {
    kind: "step",
    step: "github-clone",
    title: `Clone ${fullName(repo)} into ${shownText(into)}`,
  } as const;
  context.progress({ ...step, status: "started" });
  await checkNewFolder(request);
  await cloneRepo(context, request);
  context.progress({ ...step, status: "done" });
  return { into };
}
