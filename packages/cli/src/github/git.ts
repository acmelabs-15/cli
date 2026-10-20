import { z } from "zod";

import { outsideError } from "../command/outcome";
import type { World } from "../command/world";
import type { StepContext } from "./gh";

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
 * A full commit sha, as git and GitHub write it: 40 characters, each 0 to 9 or a to f. A sha goes
 * into a git command line, so the check keeps out an option such as `--help`, and any other text.
 */
export const commitShaSchema = z.string().regex(/^[\da-f]{40}$/u, {
  error: (issue) =>
    `${JSON.stringify(issue.input)} is not a commit sha; a sha is 40 characters, each 0 to 9 or a to f`,
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
    throw new Error(`inLocalHistory takes a full commit sha, not ${JSON.stringify(sha)}`);
  }
  const commandLine = ["git", "merge-base", "--is-ancestor", sha, "HEAD"];
  const spawned = await context.spawn(commandLine, { cwd: localRoot, env: gitEnv(context.env) });
  if (spawned.code === 0) {
    return true;
  }
  if (spawned.code === 1 || spawned.code === 128) {
    return false;
  }
  const said = spawned.stderr.trim();
  const failed = `${commandLine.join(" ")} in ${localRoot} failed with exit ${spawned.code}`;
  throw outsideError(said === "" ? failed : `${failed}: ${said}`);
}
