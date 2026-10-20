import { z } from "zod";

import { inputError, problem } from "../command/outcome";
import type { StepContext } from "./gh";
import { answerOrThrow, ghApi, readBody, repoPath } from "./gh";
import type { GitHubRepo } from "./names";
import { fullName } from "./names";

/** The Actions setting: read-only workflow tokens, and workflows may create and approve PRs. */
export const actionsSetting = {
  default_workflow_permissions: "read",
  can_approve_pull_request_reviews: true,
} as const;

/**
 * GitHub's answer to a read of the Actions setting. A field that the answer leaves out counts as
 * different, so the step writes the setting; a field of another type is an answer the step cannot
 * read.
 */
const actionsSettingBody = z
  .object({
    default_workflow_permissions: z.string(),
    can_approve_pull_request_reviews: z.boolean(),
  })
  .partial();

/**
 * Whether GitHub's answer holds the Actions setting: each field as `actionsSetting` has it. The read
 * keeps only the setting's fields, so the answer holds the setting when it equals it.
 */
function hasActionsSetting(current: z.output<typeof actionsSettingBody>): boolean {
  return Bun.deepEquals(current, actionsSetting);
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
  const current = readBody(await ghApi(context, { path }), repo, actionsSettingBody);
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

/** Protect main: no force-push and no deletion on the default branch, and no one may bypass it. */
export const protectMain = {
  name: "Protect main",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
  bypass_actors: [],
} as const;

/**
 * The repo's own rulesets, as GitHub lists them: each one's id and name. The list leaves out the
 * conditions, the rules and the bypass list (note 09, section 2.6), so the step gets "Protect main"
 * by its id, which goes into an API path and so is a positive whole number.
 */
const rulesetListBody = z.array(z.object({ id: z.int().positive(), name: z.string() }));

/**
 * One ruleset, as GitHub answers a read of it: the fields that the step compares. A field that the
 * answer leaves out counts as different, so the step writes Protect main. GitHub gives the bypass
 * list only to a login that may write the ruleset (note 09, section 2.6): without it the step
 * writes, and GitHub refuses the write of a login that may not. The lists are read-only, so
 * `protectMain` passes as a ruleset too, and one function gives the compared fields of both.
 */
const rulesetBody = z
  .object({
    name: z.string(),
    target: z.string(),
    enforcement: z.string(),
    conditions: z
      .object({
        ref_name: z
          .object({
            include: z.array(z.string()).readonly(),
            exclude: z.array(z.string()).readonly(),
          })
          .partial(),
      })
      .partial()
      .nullable(),
    rules: z.array(z.object({ type: z.string() })).readonly(),
    bypass_actors: z
      .array(
        z
          .object({
            actor_id: z.number().nullable(),
            actor_type: z.string(),
            bypass_mode: z.string(),
          })
          .partial(),
      )
      .readonly(),
  })
  .partial();

/** A ruleset's compared fields, as GitHub's answer and `protectMain` both hold them. */
type Ruleset = z.output<typeof rulesetBody>;

/**
 * What the step compares in a ruleset: the name, target, enforcement, included and excluded refs,
 * rule types and bypass list. Order inside a list does not matter, so each list is sorted.
 */
function comparedFields(ruleset: Ruleset) {
  const refs = ruleset.conditions?.ref_name;
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    include: refs?.include?.toSorted(),
    exclude: refs?.exclude?.toSorted(),
    rules: ruleset.rules?.map((rule) => rule.type).toSorted(),
    bypass: ruleset.bypass_actors
      ?.map((actor) => JSON.stringify([actor.actor_type, actor.actor_id, actor.bypass_mode]))
      .toSorted(),
  };
}

/**
 * Whether a ruleset is Protect main: each compared field as `protectMain` has it. `protectMain`
 * holds every compared field, so a field that the ruleset leaves out, undefined, always differs.
 */
function isProtectMain(ruleset: Ruleset): boolean {
  return Bun.deepEquals(comparedFields(ruleset), comparedFields(protectMain));
}

/** The repo's rulesets page, where an admin of the repo removes a ruleset. */
function rulesPage(repo: GitHubRepo): string {
  return `https://github.com/${fullName(repo)}/settings/rules`;
}

/**
 * Gives the repo Protect main. It lists the repo's own rulesets, then reads the one named "Protect
 * main": equal to `protectMain`, the step is skipped; different, a PUT on its id writes the body.
 * With none, a POST makes it. Rulesets of other names get no call. Two named "Protect main" are an
 * input failure, exit 2, because the step cannot tell which one to keep.
 */
export async function ensureProtectMain(
  context: StepContext,
  repo: GitHubRepo,
): Promise<"done" | "skipped"> {
  // The names pass their check before the step starts, so no title shows a name that fails it.
  const rulesetsPath = repoPath(repo, "rulesets");
  const step = {
    kind: "step",
    step: "github-protect-main",
    title: `Set Protect main on ${fullName(repo)}`,
  } as const;
  context.progress({ ...step, status: "started" });
  // A repo holds at most 75 rulesets (note 09, section 2.6), so one page of 100 holds them all. The
  // organization's rulesets stay out of the list: the repo's own endpoints cannot change them.
  const list = await ghApi(context, {
    path: `${rulesetsPath}?includes_parents=false&per_page=100`,
  });
  const named = readBody(list, repo, rulesetListBody).filter(
    (ruleset) => ruleset.name === protectMain.name,
  );
  if (named.length > 1) {
    const ids = named.map((ruleset) => ruleset.id).join(", ");
    throw inputError(
      `${fullName(repo)} has ${named.length} rulesets named "${protectMain.name}" (${ids}), and acmelabs cannot tell which one to keep; remove all but one at ${rulesPage(repo)}, then run the command again`,
    );
  }
  const [found] = named;
  if (found === undefined) {
    answerOrThrow(
      await ghApi(context, { method: "POST", path: rulesetsPath, body: protectMain }),
      repo,
    );
    context.progress({ ...step, status: "done", detail: "created" });
    return "done";
  }
  const path = repoPath(repo, `rulesets/${found.id}`);
  const current = readBody(await ghApi(context, { path }), repo, rulesetBody);
  if (isProtectMain(current)) {
    context.progress({ ...step, status: "skipped", detail: "already set" });
    return "skipped";
  }
  answerOrThrow(await ghApi(context, { method: "PUT", path, body: protectMain }), repo);
  context.progress({ ...step, status: "done", detail: "updated" });
  return "done";
}
