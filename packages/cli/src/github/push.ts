import { lstat } from "node:fs/promises";

import type { CommandError } from "../command/outcome";
import { inputError } from "../command/outcome";
import type { StepContext } from "./gh";
import { shownText } from "./gh";
import type { CloneRequest, OriginUrl, RemoteBranchRequest } from "./git";
import {
  addOrigin,
  checkBranchNames,
  cloneRepo,
  cloneUrlInUse,
  httpsUrl,
  localCommit,
  originUrls,
  originUrlsInUse,
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
 * The input failure, exit 2, for a rewrite in git's config that moves the repo's HTTPS URL `url`:
 * `rewritten` names what git rewrites, such as the remote origin of a folder, `moved` is the URL
 * that git would use instead, shown without its login part, and `only` says what acmelabs does
 * with the HTTPS URL alone, such as `pushes acmelabs-15/jev only to`. The message reads: git's
 * config rewrites <rewritten>, <url>, to <moved>; acmelabs <only> that HTTPS URL, with gh's login,
 * so remove the rewrite, and it names the command line that lists each rewrite.
 */
function rewriteRefused(
  rewritten: string,
  url: string,
  moved: OriginUrl,
  only: string,
): CommandError {
  return inputError(
    `git's config rewrites ${rewritten}, ${url}, to ${shownUrl(moved)}; acmelabs ${only} that HTTPS URL, with gh's login, so remove the rewrite (git config --show-origin --get-regexp '^url\\.' lists each one)`,
  );
}

/**
 * Makes sure that git's config moves no URL of the remote origin: each URL that `git ls-remote`
 * and `git push` use, after the rewrites (url.<base>.insteadOf and pushInsteadOf), must be the
 * repo's HTTPS URL. A rewrite that moves one is an input failure, exit 2, that names the URL git
 * would use, before any call reaches a remote: on another host, git would send it a login from
 * the user's own credential helper, and the SSH form would skip gh's login (ADR-0014).
 */
async function refuseRewrites(context: StepContext, { repo, cwd }: PushRequest): Promise<void> {
  const url = httpsUrl(repo);
  const inUse = await originUrlsInUse(context, cwd);
  const moved = inUse.find(({ value }) => value !== url);
  if (moved !== undefined) {
    const origin = `the remote origin of ${shownText(cwd)}`;
    throw rewriteRefused(origin, url, moved, `pushes ${fullName(repo)} only to`);
  }
}

/**
 * Pushes the local branch to the repo on GitHub, through the remote origin and gh's login. It adds
 * origin when the local repo has none, refuses a rewrite in git's config that moves origin's URL,
 * reads GitHub's branch with `git ls-remote`, and reports the step as skipped when that branch is
 * at the local commit already. Else it pushes, and sets origin's branch as the upstream. A push is
 * never forced. The messages show the folder, a URL from the git config and git's commit as
 * `shownText` gives them.
 */
export async function push(context: StepContext, request: PushRequest): Promise<Pushed> {
  const { repo, cwd, branch } = request;
  // The names and the branch pass their checks before the step starts, so no title shows one that
  // fails.
  httpsUrl(repo);
  checkBranchNames("the branch to push is not a branch name that git allows", { branch });
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
  await refuseRewrites(context, request);
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
 * Makes sure that git's config does not move the URL that the clone uses: after the rewrites
 * (url.<base>.insteadOf), it must be the repo's HTTPS URL. A rewrite that moves it is an input
 * failure, exit 2, that names the URL git would use, before the clone reaches a remote, for the
 * reasons that `refuseRewrites` gives.
 */
async function refuseCloneRewrite(context: StepContext, { repo }: CloneRequest): Promise<void> {
  const url = httpsUrl(repo);
  const inUse = await cloneUrlInUse(context, repo);
  if (inUse.value !== url) {
    const name = fullName(repo);
    throw rewriteRefused(`the URL of ${name}`, url, inUse, `clones ${name} only from`);
  }
}

/**
 * Clones the repo from its HTTPS URL into a new folder, through gh's login. The folder must not
 * exist yet: an existing one is an input failure, exit 2, before any git call, and so is a folder
 * with no name. A rewrite in git's config that moves the URL is an input failure, exit 2, before
 * the clone. A relative folder is relative to the working folder, for the check and for git
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
  await refuseCloneRewrite(context, request);
  await cloneRepo(context, request);
  context.progress({ ...step, status: "done" });
  return { into };
}
