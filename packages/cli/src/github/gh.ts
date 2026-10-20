import { z } from "zod";

import type { Context } from "../command/command";
import type { CommandError, Issue, Json } from "../command/outcome";
import { inputError, loginNeeded, outsideError } from "../command/outcome";
import type { SpawnOptions, Spawned } from "../command/world";
import type { GitHubRepo } from "./names";
import { fullName, ownerSchema, repoNameSchema } from "./names";

/** What a GitHub step runs in: the command's context without `ask`, because no step asks. */
export type StepContext = Omit<Context<unknown>, "ask">;

/** The HTTP methods the steps send. No step deletes. */
export type Method = "GET" | "POST" | "PUT";

/**
 * The two statuses that GitHub can give for a few seconds right after a create, before the new repo
 * reaches every server (note 09, section 3.1). ghApi tries a call again after either one, unless
 * the call expects it.
 */
export type RetriedStatus = 404 | 409;

/**
 * One REST call through gh: the method (GET when unset), the API path, a write's JSON body, and
 * `expected`: each 404 or 409 that the step reads itself, such as 404 for "no such tag". A 404 or
 * 409 named in `expected` comes back at once. One that is not named is tried again first, on a
 * GET or a PUT, unless gh names a missing scope (see `ghApi`). Every other status comes back at
 * once in any case, so a step reads a 422, say, with no entry here.
 */
export type GhRequest = {
  method?: Method;
  path: string;
  body?: Json;
  expected?: readonly RetriedStatus[];
};

/**
 * GitHub's answer to one call, ok or not, with the call's method and path. An ok answer (2xx) has
 * its JSON body, or null for a 204, which has none. Any other answer has its HTTP status, GitHub's
 * message, the error body, and `missingScope`: the scope that gh says the gh login lacks for the
 * call, when gh names one. A step reads the answers it expects, such as a 404 for "no such PR",
 * and gives the rest to `answerOrThrow`.
 */
export type GhAnswer =
  | { ok: true; method: Method; path: string; body: Json }
  | {
      ok: false;
      method: Method;
      path: string;
      status: number;
      message: string;
      body: Json;
      missingScope?: string;
    };

/** The command line that gives gh a login: the failures for no login and a 401 name it. */
export const ghLogin = "gh auth login";

/**
 * The command line that adds a scope to gh's login, such as `gh auth refresh -h github.com -s
 * workflow`: the failure for a missing scope names it.
 */
export function ghRefresh(scope: string): string {
  return `gh auth refresh -h github.com -s ${scope}`;
}

/**
 * The headers of every call: GitHub's JSON media type, and the REST API version that the spec's
 * "Tech stack" picks.
 */
const headers = [
  "-H",
  "Accept: application/vnd.github+json",
  "-H",
  "X-GitHub-Api-Version: 2026-03-10",
] as const;

/** The variables every gh call adds: gh asks nothing, and prints no notice of a new release. */
const ghEnv = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" } as const;

/**
 * A JSON object, such as GitHub's error body: its fields by name. A step reads an ok answer's body
 * with `readBody` instead.
 */
type JsonObject = Readonly<Record<string, Json | undefined>>;

/** Whether a JSON value is an object: not a list, text, a number, a boolean or null. */
function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * gh's stderr line for an HTTP error, with the HTTP code: `gh: Not Found (HTTP 404)`, or
 * `gh: HTTP 502` for a body with no message (note 09, section 1.2).
 */
const httpErrorLine = /^gh: (?:.* \(HTTP (?<code>\d{3})\)|HTTP (?<bare>\d{3}))$/mu;

/**
 * The HTTP status of an error answer. GitHub's error body holds it as text, such as
 * `"status":"404"`; for a body without it, gh's stderr line names it. Undefined when neither does.
 */
function statusOf(body: Json, stderr: string): number | undefined {
  if (isJsonObject(body) && typeof body.status === "string" && /^\d{3}$/u.test(body.status)) {
    return Number(body.status);
  }
  const line = httpErrorLine.exec(stderr)?.groups;
  const code = line?.code ?? line?.bare;
  return code === undefined ? undefined : Number(code);
}

/**
 * gh's second stderr line on a 4xx other than 422, when the token lacks a scope that the endpoint
 * checks: `gh: This API operation needs the "admin:org" scope. To request it, run: ...` (note 09,
 * section 1.2). gh writes the one scope with Go's %q, so it sits in double quotes.
 */
const scopeLines = /^gh: This API operation needs the "(?<scope>[^"\n]*)" scope\./gmu;

/**
 * A plain OAuth scope, such as repo, workflow, admin:org or write:packages: a lowercase letter,
 * then lowercase letters and underscores, with at most one colon inside, and a letter after it.
 */
const plainScope = /^[a-z][_a-z]*(?::[a-z][_a-z]*)?$/u;

/**
 * The scope that gh's scope line names, or undefined when gh names none. gh prints the line after
 * the line with GitHub's message, so the last match is gh's own, and a line inside GitHub's
 * message cannot win over it. acmelabs builds the command line that fixes the login from the
 * scope, so a scope that is not a plain scope counts as none: no text from gh goes into a command
 * line that the user runs.
 */
function missingScopeOf(stderr: string): string | undefined {
  const scope = [...stderr.matchAll(scopeLines)].at(-1)?.groups?.scope;
  return scope !== undefined && plainScope.test(scope) ? scope : undefined;
}

/** GitHub's message in its error body; a body without one says so, as the failure shows it. */
function messageOf(body: Json): string {
  return isJsonObject(body) && typeof body.message === "string" ? body.message : "no message";
}

/**
 * The outside failure for a gh call whose answer ghApi cannot read: an ok answer that is not JSON,
 * or an exit with no GitHub error body, such as a network failure. It names the call, and what gh
 * printed on stderr.
 */
function unreadable(call: string, spawned: Spawned): CommandError {
  const what =
    spawned.code === 0 ? "gave an answer that is not JSON" : `failed with exit ${spawned.code}`;
  const said = spawned.stderr.trim();
  return outsideError(said === "" ? `gh api ${call} ${what}` : `gh api ${call} ${what}: ${said}`);
}

/** gh's stdout as JSON: null when empty, as for a 204; undefined when it is not JSON. */
function jsonOf(stdout: string): Json | undefined {
  if (stdout.trim() === "") {
    return null;
  }
  try {
    // JSON.parse gives only what JSON holds, so the value is Json.
    return JSON.parse(stdout) as Json;
  } catch {
    return undefined;
  }
}

/**
 * The `gh api` command line and spawn options of one call. A write adds `--input -` and sends its
 * body as JSON on stdin.
 */
function ghCall(
  method: Method,
  path: string,
  body: Json | undefined,
): [readonly string[], SpawnOptions] {
  const read = ["gh", "api", "--hostname", "github.com", "--method", method, ...headers, path];
  if (body === undefined) {
    return [read, { env: ghEnv }];
  }
  return [[...read, "--input", "-"], { env: ghEnv, stdin: JSON.stringify(body) }];
}

/** Sends one call to gh once and reads GitHub's answer, as `ghApi` describes. */
async function callOnce(
  context: StepContext,
  method: Method,
  path: string,
  body: Json | undefined,
): Promise<GhAnswer> {
  const spawned = await context.spawn(...ghCall(method, path, body));
  // gh exits 4 when it has no login at all, before it calls GitHub (note 09, section 1.3).
  if (spawned.code === 4) {
    throw loginNeeded("gh", ghLogin);
  }
  const answer = jsonOf(spawned.stdout);
  if (answer === undefined) {
    throw unreadable(`${method} ${path}`, spawned);
  }
  if (spawned.code === 0) {
    return { ok: true, method, path, body: answer };
  }
  // On an HTTP error, gh exits 1 with GitHub's error body on stdout (note 09, section 1.2).
  const status = spawned.code === 1 ? statusOf(answer, spawned.stderr) : undefined;
  if (status === undefined) {
    throw unreadable(`${method} ${path}`, spawned);
  }
  return {
    ok: false,
    method,
    path,
    status,
    message: messageOf(answer),
    body: answer,
    missingScope: missingScopeOf(spawned.stderr),
  };
}

/** The statuses of `RetriedStatus`, which ghApi checks an answer against. */
const retriedStatuses: ReadonlySet<number> = new Set<RetriedStatus>([404, 409]);

/** How often ghApi tries a call again, and how long it waits before each try, as the spec says. */
const retry = { times: 3, waitMs: 3000 } as const;

/**
 * Whether ghApi tries a call again after this answer: a 404 or 409 that the call does not expect,
 * to a GET or a PUT. Both are idempotent (RFC 9110, section 9.2.2): a second one leaves GitHub as
 * one does. A POST is never sent again, because GitHub may have applied it, and a second POST
 * could create twice. An answer for which gh names a missing scope is final too: no wait gives
 * the login that scope.
 */
function triesAgainAfter(answer: GhAnswer, expected: readonly number[]): boolean {
  return (
    !answer.ok &&
    answer.method !== "POST" &&
    answer.missingScope === undefined &&
    retriedStatuses.has(answer.status) &&
    !expected.includes(answer.status)
  );
}

/**
 * Makes one REST call through `gh api` and reads GitHub's answer. gh with no login at all is a
 * login failure, and an answer that is not JSON is an outside failure; every HTTP answer comes
 * back, ok or not. A 404 or 409 that the call does not expect is tried again up to 3 times, 3
 * seconds apart, before it comes back: right after a create, GitHub can give either for a few
 * seconds. A POST, and an answer for which gh names a missing scope, come back at once
 * (`triesAgainAfter` says why). Each wait goes through `context.sleep`, so a cancel stops it.
 * Only gh.ts starts gh for the API.
 */
export async function ghApi(context: StepContext, request: GhRequest): Promise<GhAnswer> {
  const method = request.method ?? "GET";
  const { path, body, expected = [] } = request;
  let answer = await callOnce(context, method, path, body);
  for (let tried = 0; tried < retry.times && triesAgainAfter(answer, expected); tried += 1) {
    await context.sleep(retry.waitMs);
    answer = await callOnce(context, method, path, body);
  }
  return answer;
}

/** An answer that is not ok. */
type FailedAnswer = Extract<GhAnswer, { ok: false }>;

/**
 * Whether GitHub stopped the call at a rate limit: a 403 or a 429 whose message says "rate limit"
 * (note 09, section 3.4). Any other 403 is a login with too little access.
 */
function rateLimited(answer: FailedAnswer): boolean {
  return (answer.status === 403 || answer.status === 429) && /rate limit/iu.test(answer.message);
}

/**
 * Whether GitHub's error body says that a repo of the name already exists: an item of its `errors`
 * whose message says "name already exists", as GitHub answers a create of a repo whose name is
 * taken in the organization (note 09, section 2.3).
 */
function nameTaken(body: Json): boolean {
  const errors = isJsonObject(body) ? body.errors : undefined;
  return (
    Array.isArray(errors) &&
    errors.some(
      (item: Json) =>
        isJsonObject(item) &&
        typeof item.message === "string" &&
        item.message.includes("name already exists"),
    )
  );
}

/**
 * The failure for an answer that a step does not expect, by the spec's table "GitHub's answers and
 * the failure kinds". gh does not tell the login, so a message that names it says "the gh login".
 * A rate limit wins over a missing scope: the limit is what stopped this answer. GitHub answers 404,
 * not 403, to a login that may not write a private resource (note 09, section 2.9), so a 404 on a
 * write names the access, and only a 404 on a read says that GitHub found no repo. A 422 "name
 * already exists" comes from a create whose name another run or a person took after the step's
 * read, or a repo that the login cannot see: an input failure, exit 2. Any other 422 is an outside
 * failure, as the table's other answers are.
 */
function failureFor(answer: FailedAnswer, repo: GitHubRepo): CommandError {
  const call = `${answer.method} ${answer.path}`;
  if (answer.status === 401) {
    return loginNeeded("gh", ghLogin);
  }
  if (rateLimited(answer)) {
    return outsideError(
      `GitHub's rate limit stopped ${call}; wait, then run the command again (HTTP ${answer.status}): ${answer.message}`,
    );
  }
  if (answer.missingScope !== undefined) {
    return loginNeeded("gh", ghRefresh(answer.missingScope));
  }
  if (answer.status === 404 && answer.method !== "GET") {
    return inputError(
      `GitHub answered ${call} with HTTP 404: the gh login may lack write access to ${fullName(repo)}, or the resource may not exist`,
    );
  }
  if (answer.status === 404) {
    return inputError(
      `GitHub found no repo ${fullName(repo)} for the gh login (HTTP 404 on ${call}); check the owner and the name, and the login's access to the repo`,
    );
  }
  if (answer.status === 403) {
    return inputError(
      `GitHub refused ${call} for the gh login, which needs more access to ${fullName(repo)} (HTTP 403): ${answer.message}`,
    );
  }
  if (answer.status === 422 && nameTaken(answer.body)) {
    return inputError(
      `GitHub refused ${call} for the gh login: a repo named ${fullName(repo)} already exists, made a moment ago by another run or a person, or hidden from the login (HTTP 422); run the command again, or pick another name`,
    );
  }
  return outsideError(`GitHub answered ${call} with HTTP ${answer.status}: ${answer.message}`);
}

/**
 * The body of an ok answer. Any other answer throws the failure that the spec's table gives it, so
 * a step reads the answers it expects first, then gives the rest here.
 */
export function answerOrThrow(answer: GhAnswer, repo: GitHubRepo): Json {
  if (!answer.ok) {
    throw failureFor(answer, repo);
  }
  return answer.body;
}

/**
 * One thing wrong in a body, as a failure's message names it: its place in the body, then what is
 * wrong. A thing wrong with the whole body has no place.
 */
function wrongThing(issue: Issue): string {
  return issue.field === "" ? issue.message : `${issue.field}: ${issue.message}`;
}

/**
 * The body of an ok answer, read with a schema, which drops the fields it does not name. Any other
 * answer throws the failure that the spec's table gives it, as `answerOrThrow` does, so a step
 * reads the answers it expects, such as a 404, before it gives the answer here. A body of
 * another shape is an outside failure, exit 3: GitHub answered something the step cannot read. Its
 * message names the call and the first thing wrong, with each thing wrong as an issue at its place
 * in the body, such as `[0].id`.
 */
export function readBody<Schema extends z.ZodType>(
  answer: GhAnswer,
  repo: GitHubRepo,
  schema: Schema,
): z.output<Schema> {
  const read = schema.safeParse(answerOrThrow(answer, repo));
  if (read.success) {
    return read.data;
  }
  const issues = read.error.issues.map((issue) => ({
    field: z.core.toDotPath(issue.path),
    message: issue.message,
  }));
  // zod gives at least one issue for a body it cannot read.
  const [first = "", ...rest] = issues.map(wrongThing);
  const more = rest.length === 0 ? "" : ` (and ${rest.length} more)`;
  throw outsideError(
    `gh api ${answer.method} ${answer.path} gave an answer that acmelabs cannot read: ${first}${more}`,
    issues,
  );
}

/** The two names of a repo, each with its check. */
const repoSchema = z.object({ owner: ownerSchema, name: repoNameSchema });

/**
 * The API path of one of a repo's resources: `repos/{owner}/{name}/{rest}`, or of the repo itself,
 * `repos/{owner}/{name}`, with no `rest`. The owner and the name go into the path, so each passes
 * its name check first: one that fails is an input failure, exit 2, before any call. `rest` is the
 * caller's own text, such as `actions/permissions/workflow`; a caller that puts a value in it, such
 * as a branch, encodes the value first.
 */
export function repoPath(repo: GitHubRepo, rest?: string): string {
  const checked = repoSchema.safeParse(repo);
  if (!checked.success) {
    throw inputError(
      `${JSON.stringify(fullName(repo))} is not a GitHub repo`,
      checked.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return rest === undefined ? `repos/${fullName(repo)}` : `repos/${fullName(repo)}/${rest}`;
}
