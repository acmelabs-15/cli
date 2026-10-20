import type { Json } from "../command/outcome";
import { problem } from "../command/outcome";
import type { StepContext } from "./gh";
import { answerOrThrow, ghApi, isJsonObject, repoPath } from "./gh";
import type { GitHubRepo } from "./names";
import { fullName } from "./names";

/** The Actions setting: read-only workflow tokens, and workflows may create and approve PRs. */
export const actionsSetting = {
  default_workflow_permissions: "read",
  can_approve_pull_request_reviews: true,
} as const;

/** Whether GitHub's answer holds the Actions setting: each field as `actionsSetting` has it. */
function hasActionsSetting(current: Json): boolean {
  return (
    isJsonObject(current) &&
    Object.entries(actionsSetting).every(([field, value]) => current[field] === value)
  );
}

/**
 * The organization's Actions settings page, where an owner of the organization allows workflows to
 * create and approve pull requests (note 09, section 2.5).
 */
function orgActionsPage(owner: string): string {
  return `https://github.com/organizations/${owner}/settings/actions`;
}

/**
 * Gives the repo the Actions setting. It reads the setting first and reports the step as skipped
 * when the setting is already there. A 409 means the organization forbids the setting: a problem,
 * exit 1, whose message names the organization's Actions settings page.
 */
export async function ensureActionsSetting(
  context: StepContext,
  repo: GitHubRepo,
): Promise<"done" | "skipped"> {
  // The names pass their check before the step starts, so no title shows a name that fails it.
  const path = repoPath(repo, "actions/permissions/workflow");
  const step = {
    kind: "step",
    step: "github-actions-setting",
    title: `Set the Actions setting on ${fullName(repo)}`,
  } as const;
  context.progress({ ...step, status: "started" });
  const current = answerOrThrow(await ghApi(context, { path }), repo);
  if (hasActionsSetting(current)) {
    context.progress({ ...step, status: "skipped", detail: "already set" });
    return "skipped";
  }
  const written = await ghApi(context, { method: "PUT", path, body: actionsSetting });
  if (!written.ok && written.status === 409) {
    throw problem(
      `the ${repo.owner} organization forbids the Actions setting on ${fullName(repo)}; an owner of the organization turns on "Allow GitHub Actions to create and approve pull requests" at ${orgActionsPage(repo.owner)}, then runs the command again`,
    );
  }
  // A 204 has no body to read; any other answer that is not ok ends the step with its failure.
  answerOrThrow(written, repo);
  context.progress({ ...step, status: "done" });
  return "done";
}
