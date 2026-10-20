import type { ProgressUpdate } from "../../command/command";
import type { ScriptedSpawn, WorldCall } from "../../command/fake-world";
import type { Spawned, World } from "../../command/world";
import type { Method } from "../gh";

/**
 * What a front-end gives runCommand, for a sample command that calls a step: the world, a log of
 * the progress updates, and a live signal.
 */
export function frontEnd(world: World) {
  const updates: ProgressUpdate[] = [];
  return {
    world,
    progress(update: ProgressUpdate) {
      updates.push(update);
    },
    signal: new AbortController().signal,
    updates,
  };
}

/**
 * One `gh api` call as a test writes it: the method (GET when unset), the API path, and for a write
 * the JSON body as gh reads it on stdin, written out as text.
 */
export type GhCall = { method?: Method; path: string; stdin?: string };

/**
 * The `gh api` command line of one call, word for word as the spec's "How a step calls gh and git"
 * gives it. It is written out here, not taken from `gh.ts`, so a test fails when `gh.ts` drifts.
 */
export function ghCommandLine(call: GhCall): string[] {
  return [
    "gh",
    "api",
    "--hostname",
    "github.com",
    "--method",
    call.method ?? "GET",
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    "X-GitHub-Api-Version: 2026-03-10",
    call.path,
    ...(call.stdin === undefined ? [] : ["--input", "-"]),
  ];
}

/**
 * fakeWorld's log entry for one call: the command line, the two variables that every gh call adds,
 * and for a write the body on stdin.
 */
export function ghLogged(call: GhCall): WorldCall {
  const env = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" };
  const commandLine = ghCommandLine(call);
  return call.stdin === undefined
    ? { kind: "spawn", commandLine, env }
    : { kind: "spawn", commandLine, stdin: call.stdin, env };
}

/** A scripted fakeWorld answer to one call: gh's exit code, stdout and stderr. */
export function ghScripted(call: GhCall, answer: Spawned): ScriptedSpawn {
  return { commandLine: ghCommandLine(call), answer };
}

/**
 * The scripted answers to every try of a call that GitHub answers with the same unexpected 404 or
 * 409 each time: 4 answers, for the first try and the 3 tries again of the spec's "What each step
 * does". The answer becomes final after the last try.
 */
export function ghScriptedEveryTry(call: GhCall, answer: Spawned): ScriptedSpawn[] {
  return Array.from({ length: 4 }, () => ghScripted(call, answer));
}

/**
 * fakeWorld's log entries for every try of a call that GitHub answers with the same unexpected 404
 * or 409 each time: the call, then a 3-second sleep and the call again, three times.
 */
export function ghLoggedEveryTry(call: GhCall): WorldCall[] {
  const retry: WorldCall[] = [{ kind: "sleep", ms: 3000 }, ghLogged(call)];
  return [ghLogged(call), ...retry, ...retry, ...retry];
}

/** gh's answer to an HTTP error: GitHub's error body on stdout, gh's line on stderr, and exit 1. */
function httpError(body: string, stderr: string): Spawned {
  return { code: 1, stdout: body, stderr };
}

/**
 * gh's answers to the calls the steps make. Each one is real, from note 09
 * (`docs/research/09-github-steps.md`), unless its comment says it is built: a built answer is not
 * probed, and it follows the shape that note 09 found (section 1.2).
 */
export const ghAnswers = {
  /**
   * The Actions setting of acmelabs-15/brain, cli and jev-gate, read on 2026-10-20 (note 09,
   * section 2.5).
   */
  actionsSetting: {
    code: 0,
    stdout: '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}',
    stderr: "",
  },
  /** The Actions setting of acmelabs-15/skills: workflows may not approve PRs (note 09, 2.5). */
  actionsSettingNoApproval: {
    code: 0,
    stdout: '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}',
    stderr: "",
  },
  /** A 204, as the Actions setting's PUT answers: gh prints nothing and exits 0 (note 09, 2.2). */
  noContent: { code: 0, stdout: "", stderr: "" },
  /**
   * acmelabs-15/brain's rulesets, one item, "Protect main": the list leaves out its conditions, its
   * rules and its bypass list. Read under API version 2026-03-10 (note 09, section 2.6).
   */
  rulesetsOfBrain: {
    code: 0,
    stdout:
      '[{"id":25457893,"name":"Protect main","target":"branch","source_type":"Repository","source":"acmelabs-15/brain","enforcement":"active","node_id":"RRS_lACqUmVwb3NpdG9yec5GCidjzgGEdOU","_links":{"self":{"href":"https://api.github.com/repos/acmelabs-15/brain/rulesets/25457893"},"html":{"href":"https://github.com/acmelabs-15/brain/rules/25457893"}},"created_at":"2026-10-19T23:50:57.764-07:00","updated_at":"2026-10-19T23:50:57.801-07:00"}]',
    stderr: "",
  },
  /** No rulesets: acmelabs-15/jev-gate's list, read under 2026-03-10 (note 09, section 2.6). */
  noRulesets: { code: 0, stdout: "[]", stderr: "" },
  /** acmelabs-15/brain's "Protect main", whole, read under 2026-03-10 (note 09, section 2.6). */
  protectMainOfBrain: {
    code: 0,
    stdout:
      '{"id":25457893,"name":"Protect main","target":"branch","source_type":"Repository","source":"acmelabs-15/brain","enforcement":"active","conditions":{"ref_name":{"exclude":[],"include":["~DEFAULT_BRANCH"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}],"node_id":"RRS_lACqUmVwb3NpdG9yec5GCidjzgGEdOU","created_at":"2026-10-19T23:50:57.764-07:00","updated_at":"2026-10-19T23:50:57.801-07:00","bypass_actors":[],"current_user_can_bypass":"never","_links":{"self":{"href":"https://api.github.com/repos/acmelabs-15/brain/rulesets/25457893"},"html":{"href":"https://github.com/acmelabs-15/brain/rules/25457893"}}}',
    stderr: "",
  },
  /**
   * acmelabs-15/cli's "Protect main", whole, which the POST of note 09's section 5 made (note 09,
   * section 2.6). A POST answers with the new ruleset; the step does not read it.
   */
  protectMainOfCli: {
    code: 0,
    stdout:
      '{"id":25461155,"name":"Protect main","target":"branch","source_type":"Repository","source":"acmelabs-15/cli","enforcement":"active","conditions":{"ref_name":{"exclude":[],"include":["~DEFAULT_BRANCH"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}],"node_id":"RRS_lACqUmVwb3NpdG9yec5VCbe2zgGEgaM","created_at":"2026-10-20T01:09:23.890-07:00","updated_at":"2026-10-20T01:09:23.917-07:00","bypass_actors":[],"current_user_can_bypass":"never","_links":{"self":{"href":"https://api.github.com/repos/acmelabs-15/cli/rulesets/25461155"},"html":{"href":"https://github.com/acmelabs-15/cli/rules/25461155"}}}',
    stderr: "",
  },
  /** No such ref: acmelabs-15/cli's `git/ref/tags/latest` (note 09, section 2.9). */
  notFound: httpError(
    '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/git/refs#get-a-reference","status":"404"}',
    "gh: Not Found (HTTP 404)\n",
  ),
  /**
   * An empty repo: acmelabs-15/pinky's `git/ref/tags/latest` (note 09, section 2.9). Note 09 leaves
   * out the documentation_url; it is the one of the same endpoint's 404.
   */
  repositoryEmpty: httpError(
    '{"message":"Git Repository is empty.","documentation_url":"https://docs.github.com/rest/git/refs#get-a-reference","status":"409"}',
    "gh: Git Repository is empty. (HTTP 409)\n",
  ),
  /**
   * Built: GitHub documents a 409 on the Actions setting's PUT when the organization forbids the
   * setting, but not its body (note 09, section 2.5). The step reads only the status.
   */
  actionsSettingForbidden: httpError(
    '{"message":"Conflict","documentation_url":"https://docs.github.com/rest/actions/permissions#set-default-workflow-permissions-for-a-repository","status":"409"}',
    "gh: Conflict (HTTP 409)\n",
  ),
  /** A token that GitHub rejects: `gh api user` with a bad GH_TOKEN (note 09, section 1.2). */
  badCredentials: httpError(
    '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}',
    "gh: Bad credentials (HTTP 401)\n",
  ),
  /** No login at all: gh exits 4 before it calls GitHub (note 09, section 1.3). */
  noLogin: {
    code: 4,
    stdout: "",
    stderr:
      "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n",
  },
  /**
   * A login that may not read a setting: `orgs/acmelabs-15/actions/permissions/workflow` with a
   * token that lacks `admin:org` (note 09, section 2.5). Note 09 leaves out the documentation_url;
   * it is the one of that endpoint.
   */
  orgAdminNeeded: httpError(
    '{"message":"You must be an org admin or have the actions policies fine-grained permission.","documentation_url":"https://docs.github.com/rest/actions/permissions#get-default-workflow-permissions-for-an-organization","status":"403"}',
    'gh: You must be an org admin or have the actions policies fine-grained permission. (HTTP 403)\ngh: This API operation needs the "admin:org" scope. To request it, run:  gh auth refresh -h github.com -s admin:org\n',
  ),
  /** Built: the primary rate limit, a 403 that says "rate limit" (note 09, section 3.4). */
  rateLimited: httpError(
    '{"message":"API rate limit exceeded for user ID 1234567.","documentation_url":"https://docs.github.com/rest/overview/rate-limits-for-the-rest-api","status":"403"}',
    "gh: API rate limit exceeded for user ID 1234567. (HTTP 403)\n",
  ),
  /** Built: a secondary rate limit, a 429 that says "rate limit" (note 09, section 3.4). */
  secondaryRateLimited: httpError(
    '{"message":"You have exceeded a secondary rate limit. Please wait a few minutes before you try again.","documentation_url":"https://docs.github.com/rest/overview/rate-limits-for-the-rest-api#about-secondary-rate-limits","status":"429"}',
    "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 429)\n",
  ),
  /** Built: a 5xx, with the "Server Error" that ends a request past 10 seconds (note 09, 3.4). */
  serverError: httpError(
    '{"message":"Server Error","status":"502"}',
    "gh: Server Error (HTTP 502)\n",
  ),
  /**
   * Built: an answer that is not JSON, such as a proxy's error page. With no message in the body,
   * gh's line is `gh: HTTP <code>` (note 09, section 1.2).
   */
  htmlError: httpError(
    "<!DOCTYPE html>\n<html><body><h1>502 Bad Gateway</h1></body></html>\n",
    "gh: HTTP 502\n",
  ),
  /** Built: a 200 whose body is not JSON, such as a captive portal's page. */
  htmlPage: {
    code: 0,
    stdout: "<!DOCTYPE html>\n<html><body><h1>Sign in to the network</h1></body></html>\n",
    stderr: "",
  },
  /**
   * Built: an answer the table does not name, a 451 for a repo that GitHub blocks for legal
   * reasons, as GitHub documents for `GET /repos/{owner}/{repo}`.
   */
  accessBlocked: httpError(
    '{"message":"Repository access blocked","block":{"reason":"dmca"},"status":"451"}',
    "gh: Repository access blocked (HTTP 451)\n",
  ),
} satisfies Record<string, Spawned>;
