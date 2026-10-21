import { z } from "zod";

import type { CommandError } from "../command/outcome";
import { inputError, outsideError, problem } from "../command/outcome";
import type { Spawned, World } from "../command/world";
import type { StepContext } from "./gh";
import { ghLoginNeeded, repoPath, retry, shownText, tokenVariablesIn } from "./gh";
import type { GitHubRepo } from "./names";
import { fullName, quoted } from "./names";

/**
 * The `env` of every git call: each GIT_ variable of the World's environment removed, then
 * GIT_TERMINAL_PROMPT=0 added, so git never asks for a password on the terminal (ADR-0007). A git
 * hook exports GIT_ variables such as GIT_DIR, GIT_INDEX_FILE and GIT_COMMON_DIR, and with them a
 * git call in one folder works in another repo (ADR-0016; note 12, sections 1.3 and 1.4). `env` is
 * the World's env, the environment that its spawn passes on, so every GIT_ variable in it goes.
 * Other variables stay, such as GH_TOKEN and GITHUB_TOKEN, which gh's credential helper reads.
 */
export function gitEnv(env: World["env"]): Record<string, string | undefined> {
  const removed = Object.keys(env)
    .filter((name) => name.startsWith("GIT_"))
    .map((name) => [name, undefined] as const);
  return { ...Object.fromEntries(removed), GIT_TERMINAL_PROMPT: "0" };
}

/**
 * The words that a git call to GitHub puts before its subcommand, each one argument, as there is
 * no shell. The two helper values are the ones gh gives git for its own clone (note 09, section
 * 1.5): the empty one clears every other credential helper for github.com, then gh's helper
 * serves gh's login. So gh's login is the one login, and acmelabs never holds a token (ADR-0014).
 * `core.askPass=` stops git from starting SSH_ASKPASS or a configured askpass program, which would
 * ask for a password in a window outside `context.ask` (ADR-0007); GIT_ASKPASS goes with the GIT_
 * variables. With no login, git then ends with "terminal prompts disabled".
 */
const ghLoginWords = [
  "-c",
  "credential.https://github.com.helper=",
  "-c",
  "credential.https://github.com.helper=!gh auth git-credential",
  "-c",
  "core.askPass=",
] as const;

/** One git call: its words after `git`, and the folder it runs in, when it needs one. */
type GitCall = { words: readonly string[]; cwd?: string };

/**
 * A git call as a failure's message names it: `git <words>`, then ` in <cwd>` when it has one, as
 * `shownText` gives it. The folder, and a clone's folder among the words, come from the caller as
 * given.
 */
function described({ words, cwd }: GitCall): string {
  const line = `git ${words.join(" ")}`;
  return shownText(cwd === undefined ? line : `${line} in ${cwd}`);
}

/**
 * Runs one git program, with no shell: the one way into git, as ghApi is the one way into gh. The
 * program runs in `cwd`, without the GIT_ variables (`gitEnv`). Only git.ts starts git.
 */
function runGit(context: StepContext, { words, cwd }: GitCall): Promise<Spawned> {
  const env = gitEnv(context.env);
  return context.spawn(["git", ...words], cwd === undefined ? { env } : { cwd, env });
}

/**
 * The outside failure for a git call that ended in a way its caller does not read: it names the
 * call, the exit code and git's message, as `shownText` gives it.
 */
function gitFailed(call: GitCall, spawned: Spawned): CommandError {
  const said = shownText(spawned.stderr);
  const failed = `${described(call)} failed with exit ${spawned.code}`;
  return outsideError(said === "" ? failed : `${failed}: ${said}`);
}

/**
 * A full commit sha, as git and GitHub write it: 40 characters, each 0 to 9 or a to f. A sha goes
 * into a git command line, so the check keeps out an option such as `--help`, and any other text.
 */
export const commitShaSchema = z.string().regex(/^[\da-f]{40}$/u, {
  error: (issue) =>
    `${quoted(String(issue.input))} is not a commit sha; a sha is 40 characters, each 0 to 9 or a to f`,
});

/** What `inLocalHistory` takes: the commit, and the folder of the local git repo to look in. */
export type HistoryQuestion = { sha: string; localRoot: string };

/**
 * Whether the commit `sha` is in the local history: HEAD, or a commit that HEAD descends from, in
 * the git repo at `localRoot`. It runs `git merge-base --is-ancestor <sha> HEAD` there, which exits
 * 0 for yes and 1 for no. Exit 128 is no too: git does not know the commit, and gives 128 also for
 * a folder with no git repo or a repo with no commit yet, whose history cannot hold the commit
 * either. Any other exit is an outside failure that names the command line and git's message. The
 * call reaches no remote, so it needs no credential helper. It runs without the GIT_ variables
 * (`gitEnv`), so a git hook's GIT_DIR cannot make it answer for another repo. A sha that fails
 * `commitShaSchema` is a bug in the caller, and no git starts.
 */
export async function inLocalHistory(
  context: StepContext,
  { sha, localRoot }: HistoryQuestion,
): Promise<boolean> {
  if (!commitShaSchema.safeParse(sha).success) {
    throw new Error(`inLocalHistory takes a full commit sha, not ${quoted(sha)}`);
  }
  const call = { words: ["merge-base", "--is-ancestor", sha, "HEAD"], cwd: localRoot };
  const spawned = await runGit(context, call);
  if (spawned.code === 0) {
    return true;
  }
  if (spawned.code === 1 || spawned.code === 128) {
    return false;
  }
  throw gitFailed(call, spawned);
}

/**
 * The repo's HTTPS URL, `https://github.com/<owner>/<name>.git`: GitHub's clone_url, which works
 * for every repo with gh's login and needs no SSH key (note 09, section 4). The owner and the name
 * pass their check first (repoPath's), so no other text goes into the URL: one that fails is an
 * input failure, exit 2.
 */
export function httpsUrl(repo: GitHubRepo): string {
  repoPath(repo);
  return `https://github.com/${fullName(repo)}.git`;
}

/**
 * A branch name that git allows, by git's own rules (git check-ref-format, with --branch): no
 * control character, space, "~", "^", ":", "?", "*", "[" or "\", no "..", "@{" or "//", no part
 * that starts with "." or ends with ".lock"; not starting with "-", "/" or ".", not ending with
 * "/" or ".", and not HEAD. A branch goes into a git command line, so the check keeps out a
 * refspec's ":" (`:main` deletes GitHub's main) and "*", and revision syntax such as `main~1`. A
 * pull request's head goes into GitHub's `owner:branch`, where a ":" would name another owner's
 * branch. Beyond git's rules, the check keeps out a format character (\p{Cf}), such as a bidi
 * mark, and a line or paragraph separator: git allows them, but a step's title shows the branch,
 * and a terminal would reorder it or break its line. So a branch that passes holds none of the
 * characters that `shownText` replaces.
 */
export const branchNameSchema = z
  .string()
  .regex(
    /^(?!HEAD$)(?![-/.])(?!.*(?:\.\.|@\{|\/\/|\/\.|\.lock(?:\/|$)|[/.]$))[^\p{Cc}\p{Cf}\p{Zl}\p{Zp} ~^:?*[\\]+$/u,
    {
      error: (issue) =>
        `${quoted(String(issue.input))} is not a branch name that git allows: a branch name has no control character, space, "~", "^", ":", "?", "*", "[" or "\\", no "..", "@{" or "//", and no part that starts with "." or ends with ".lock"; it does not start with "-", "/" or ".", does not end with "/" or ".", and is not HEAD; acmelabs also refuses a format character, such as a bidi mark, and a line or paragraph separator`,
    },
  );

/**
 * Checks branch names before any call, each against `branchNameSchema`: a name that fails is an
 * input failure, exit 2, with the caller's `message` and one issue for each name that fails, at
 * its field, such as `branch`, `head` or `base`.
 */
export function checkBranchNames(
  message: string,
  branches: Readonly<Record<string, string>>,
): void {
  const issues = Object.entries(branches).flatMap(([field, branch]) => {
    const checked = branchNameSchema.safeParse(branch);
    return checked.success
      ? []
      : checked.error.issues.map((issue) => ({ field, message: issue.message }));
  });
  if (issues.length > 0) {
    throw inputError(message, issues);
  }
}

/**
 * The full ref of a local branch, `refs/heads/<branch>`, as a git command line takes it. A full
 * ref cannot be read as an option, nor as a forced push (a leading "+"), and names no tag. A
 * branch that fails `branchNameSchema` is a bug in the caller, and no git starts.
 */
function branchRef(branch: string): string {
  if (!branchNameSchema.safeParse(branch).success) {
    throw new Error(`git.ts takes a checked branch name, not ${quoted(branch)}`);
  }
  return `refs/heads/${branch}`;
}

/** One branch of a local git repo: the repo's folder, and the branch. */
export type BranchRequest = { cwd: string; branch: string };

/**
 * The commit that the local branch is at, or undefined when the repo at `cwd` has no such branch.
 * It runs `git rev-parse --verify --quiet refs/heads/<branch>` there, which prints the commit, or
 * exits 1 with no message for a branch that does not exist. Any other exit is an outside failure
 * that names the call and git's message.
 */
export async function localCommit(
  context: StepContext,
  { cwd, branch }: BranchRequest,
): Promise<string | undefined> {
  const call = { words: ["rev-parse", "--verify", "--quiet", branchRef(branch)], cwd };
  const spawned = await runGit(context, call);
  if (spawned.code === 1) {
    return undefined;
  }
  if (spawned.code !== 0) {
    throw gitFailed(call, spawned);
  }
  return spawned.stdout.trim();
}

/**
 * One URL of the local repo's remote origin: a `url`, which a fetch and a push use, or a
 * `pushurl`, which a push uses instead of the url.
 */
export type OriginUrl = { key: "url" | "pushurl"; value: string };

/**
 * The URLs of the local repo's remote origin, as its git config holds them: none when it has no
 * origin. It runs `git config --null --get-regexp ^remote\.origin\.(url|pushurl)$` in `cwd`, which
 * exits 1 with no output when no key matches, and with --null writes each key in lower case, a
 * newline, the value and a NUL, so no value can break the read. A URL rewrite in git's config
 * (url.<base>.insteadOf or pushInsteadOf) does not change what this reads, so a re-run reads the
 * URL that the first run added; `originUrlsInUse` reads the URLs after the rewrites.
 */
export async function originUrls(context: StepContext, cwd: string): Promise<OriginUrl[]> {
  const words = ["config", "--null", "--get-regexp", String.raw`^remote\.origin\.(url|pushurl)$`];
  const call = { words, cwd };
  const spawned = await runGit(context, call);
  if (spawned.code === 1 && spawned.stdout === "") {
    return [];
  }
  if (spawned.code !== 0) {
    throw gitFailed(call, spawned);
  }
  return spawned.stdout
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [name = "", ...value] = entry.split("\n");
      const key = name === "remote.origin.pushurl" ? "pushurl" : "url";
      return { key, value: value.join("\n") };
    });
}

/**
 * The URLs of one kind that git uses for the local repo's remote origin, after the rewrites in
 * git's config: `git remote get-url --all origin` in `cwd` for the `url`s, the same with --push
 * for the `pushurl`s. Each prints one URL a line. Any exit other than 0 is an outside failure that
 * names the call and git's message.
 */
async function urlsInUse(
  context: StepContext,
  cwd: string,
  key: OriginUrl["key"],
): Promise<OriginUrl[]> {
  const push = key === "pushurl" ? ["--push"] : [];
  const call = { words: ["remote", "get-url", ...push, "--all", "origin"], cwd };
  const spawned = await runGit(context, call);
  if (spawned.code !== 0) {
    throw gitFailed(call, spawned);
  }
  return spawned.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((value) => ({ key, value }));
}

/**
 * The URLs that git uses for the local repo's remote origin, after the rewrites in git's config:
 * each `url` as `git ls-remote origin` reads it, with url.<base>.insteadOf applied, then each
 * `pushurl` as `git push origin` writes to it, with url.<base>.pushInsteadOf, else insteadOf,
 * applied. A rewrite can move the one and keep the other (probes on git 2.54.0, note 09, section
 * 4), so the step checks both.
 */
export async function originUrlsInUse(context: StepContext, cwd: string): Promise<OriginUrl[]> {
  const urls = await urlsInUse(context, cwd, "url");
  return [...urls, ...(await urlsInUse(context, cwd, "pushurl"))];
}

/** A local git repo and the GitHub repo it goes to: the repo, and the local repo's folder. */
export type OriginRequest = { repo: GitHubRepo; cwd: string };

/** Adds the remote origin, the repo's HTTPS URL, to the local repo: `git remote add origin <url>`. */
export async function addOrigin(context: StepContext, { repo, cwd }: OriginRequest): Promise<void> {
  const call = { words: ["remote", "add", "origin", httpsUrl(repo)], cwd };
  const spawned = await runGit(context, call);
  if (spawned.code !== 0) {
    throw gitFailed(call, spawned);
  }
}

/**
 * GitHub's line when it finds no repo at the URL for the login: the repo does not exist, the login
 * may not see it, or GitHub has not yet made it on every server (probe, github-ops task 11).
 */
const repoNotFound = /^remote: Repository not found\.$/mu;

/**
 * GitHub's reason when it refuses the push of a workflow file from a login without the `workflow`
 * scope, as an OAuth app's token or a classic token (note 09, section 4).
 */
const workflowScopeMissing = /without `workflow` scope/u;

/**
 * git's lines when gh's helper gives no login, so that git would ask on the terminal, or GitHub
 * rejects the login it gives (probes, github-ops task 11).
 */
const noLogin = /could not read Username\b|terminal prompts disabled|Authentication failed\b/u;

/** curl's message, through git, when GitHub refuses the login access to the repo: HTTP 403. */
const accessRefused = /The requested URL returned error: 403\b/u;

/**
 * git's mark for a ref that a push did not update: `[rejected]` when GitHub's branch is not an
 * ancestor of the local one, `[remote rejected]` when GitHub refuses it, as for a rule.
 */
const pushRejected = /! \[(?:remote )?rejected\]/u;

/**
 * The failure for a git call to GitHub that did not exit 0, by the spec's table "GitHub's answers
 * and the failure kinds". The missing `workflow` scope comes first: GitHub gives it as a rejected
 * ref. A login failure names a fix that works for the login's token variables in `env`, the
 * World's env, as gh's helper reads them (`ghLoginNeeded`). A rejected push is a problem, exit 1,
 * with git's message, and is never forced. Any other end, such as a network failure, is an outside
 * failure that names the call and git's message. git's message shows as `shownText` gives it.
 */
function gitHubFailure(
  env: World["env"],
  repo: GitHubRepo,
  call: GitCall,
  spawned: Spawned,
): CommandError {
  const { stderr } = spawned;
  if (workflowScopeMissing.test(stderr)) {
    return ghLoginNeeded(tokenVariablesIn(env), { scopes: ["workflow"] });
  }
  if (noLogin.test(stderr)) {
    return ghLoginNeeded(tokenVariablesIn(env));
  }
  if (repoNotFound.test(stderr)) {
    return inputError(
      `GitHub found no repo ${fullName(repo)} for the gh login (Repository not found, on ${described(call)}); check the owner and the name, and the login's access to the repo`,
    );
  }
  // The checks read git's own lines; the message shows them as one line.
  const said = shownText(stderr);
  if (accessRefused.test(stderr)) {
    return inputError(
      `GitHub refused ${described(call)} for the gh login, which needs more access to ${fullName(repo)}: ${said}`,
    );
  }
  if (pushRejected.test(stderr)) {
    return problem(`GitHub rejected ${described(call)}, and acmelabs never forces a push: ${said}`);
  }
  return gitFailed(call, spawned);
}

/**
 * Runs one git call to GitHub with gh's login, and gives its output when it exits 0. GitHub's
 * "Repository not found" is tried again up to 3 times, 3 seconds apart, before it is final: right
 * after a create, GitHub can give it for a few seconds (note 09, section 3.1; gh tries a clone
 * again so, section 1.6). A second try is safe: GitHub gives that answer before git sends
 * anything, and a clone that gets it removes the folder it made. Each wait goes through
 * `context.sleep`, so a cancel stops it. Any other end throws the failure of `gitHubFailure`.
 */
async function runOnGitHub(
  context: StepContext,
  repo: GitHubRepo,
  call: GitCall,
): Promise<Spawned> {
  // gh's login words go before the subcommand; a failure's message names the call without them.
  const withLogin = { ...call, words: [...ghLoginWords, ...call.words] };
  let spawned = await runGit(context, withLogin);
  for (
    let tried = 0;
    tried < retry.times && spawned.code !== 0 && repoNotFound.test(spawned.stderr);
    tried += 1
  ) {
    await context.sleep(retry.waitMs);
    spawned = await runGit(context, withLogin);
  }
  if (spawned.code !== 0) {
    throw gitHubFailure(context.env, repo, call, spawned);
  }
  return spawned;
}

/** A branch of a local git repo and the GitHub repo it goes to. */
export type RemoteBranchRequest = OriginRequest & { branch: string };

/**
 * The commit that the branch is at on GitHub, read through origin, or undefined when GitHub has
 * no such branch: `git ls-remote origin refs/heads/<branch>` in `cwd`, with gh's login.
 */
export async function remoteCommit(
  context: StepContext,
  { repo, cwd, branch }: RemoteBranchRequest,
): Promise<string | undefined> {
  const ref = branchRef(branch);
  const spawned = await runOnGitHub(context, repo, { words: ["ls-remote", "origin", ref], cwd });
  // ls-remote matches its pattern against the end of each ref, so only the ref itself counts.
  for (const line of spawned.stdout.split("\n")) {
    const [sha, name] = line.split("\t");
    if (name === ref) {
      return sha;
    }
  }
  return undefined;
}

/**
 * Pushes the local branch to GitHub through origin, with gh's login, and sets origin's branch as
 * its upstream: `git push --set-upstream origin refs/heads/<branch>` in `cwd`. Never forced.
 */
export async function pushBranch(
  context: StepContext,
  { repo, cwd, branch }: RemoteBranchRequest,
): Promise<void> {
  const words = ["push", "--set-upstream", "origin", branchRef(branch)];
  await runOnGitHub(context, repo, { words, cwd });
}

/** What `cloneRepo` takes: the repo, and the folder to clone it into. */
export type CloneRequest = { repo: GitHubRepo; into: string };

/**
 * Clones the repo from its HTTPS URL into the folder, with gh's login: `git clone -- <url>
 * <into>`. "--" ends git's options, so a folder whose name starts with "-" stays a folder. The call
 * runs in no folder of its own: without the GIT_ variables, no other repo can take the clone.
 */
export async function cloneRepo(context: StepContext, { repo, into }: CloneRequest): Promise<void> {
  await runOnGitHub(context, repo, { words: ["clone", "--", httpsUrl(repo), into] });
}
