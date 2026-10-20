import { z } from "zod";

import type { Context } from "../command/command";
import type { CommandError, Issue, Json } from "../command/outcome";
import { inputError, loginNeeded, outsideError } from "../command/outcome";
import type { SpawnOptions, Spawned, World } from "../command/world";
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
 * message, the error body, `missingScope`: the scope that gh says the gh login lacks for the call,
 * when gh names one, and `tokenVariables`: the token variables of the login that made the call
 * (`tokenVariablesIn`), so that a login failure names a fix that works. A step reads the answers it
 * expects, such as a 404 for "no such PR", and gives the rest to `answerOrThrow`.
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
      tokenVariables: readonly TokenVariable[];
    };

/**
 * The variables from which gh reads a token for github.com, in gh's order: GH_TOKEN, then
 * GITHUB_TOKEN (note 09, section 1.2). gh auth login and gh auth refresh refuse to run while gh's
 * token comes from either (section 1.4).
 */
const tokenVariableNames = ["GH_TOKEN", "GITHUB_TOKEN"] as const;

/** A variable from which gh reads a token for github.com: GH_TOKEN or GITHUB_TOKEN. */
export type TokenVariable = (typeof tokenVariableNames)[number];

/** Whether a name, such as gh's `tokenSource`, is a variable from which gh reads a token. */
function isTokenVariable(name: string | undefined): name is TokenVariable {
  return tokenVariableNames.some((variable) => variable === name);
}

/** Whether the World's env sets the variable: gh counts a variable with no text as unset. */
function isSet(env: World["env"], name: TokenVariable): boolean {
  return (env[name] ?? "") !== "";
}

/**
 * The token variables that the World's env sets, in gh's order, by gh's rule: gh reads GH_TOKEN
 * when it has text, else GITHUB_TOKEN (`tokenForHost` in go-gh's pkg/auth/auth.go at v2.13.0). So
 * the first one is the variable whose token gh and gh's git helper use, and a second one is the
 * variable that gh reads once the first is cleared. None when gh's token comes from its own login.
 * ghApi and git's calls use it, because gh does not tell them where its token comes from.
 */
export function tokenVariablesIn(env: World["env"]): TokenVariable[] {
  return tokenVariableNames.filter((name) => isSet(env, name));
}

/**
 * The token variables for a login whose token comes from `source`, as gh auth status names it in
 * `tokenSource`: that variable first, then each later one in gh's order that the World's env sets.
 * None when `source` is no token variable, such as `keyring`. checkLogin uses it, because gh's own
 * answer names the source, and so wins over a rule read again here.
 */
export function tokenVariablesFrom(source: string | undefined, env: World["env"]): TokenVariable[] {
  if (!isTokenVariable(source)) {
    return [];
  }
  const first = tokenVariableNames.indexOf(source);
  return tokenVariableNames.filter(
    (name, index) => index === first || (index > first && isSet(env, name)),
  );
}

/** The command line that gives gh a new login. */
const ghLogin = "gh auth login";

/**
 * The command line that adds scopes to gh's login, such as `gh auth refresh -h github.com -s
 * workflow`. gh auth refresh takes several scopes in one --scopes, with commas between them.
 */
function ghRefresh(scopes: readonly string[]): string {
  return `gh auth refresh -h github.com -s ${scopes.join(",")}`;
}

/** The scopes as a message names them: "the workflow scope", or "the repo and workflow scopes". */
function scopesNamed(scopes: readonly string[]): string {
  const list = new Intl.ListFormat("en").format(scopes);
  return scopes.length === 1 ? `the ${list} scope` : `the ${list} scopes`;
}

/**
 * What fixes gh's login, as a login failure names it. `scopes`: the plain scopes that the login
 * lacks, which gh auth refresh adds; with none, the login itself fails, and gh auth login gives a
 * new one. `reason`: why the login fails, such as gh's own error text; it ends the message.
 */
export type GhLoginFix = { scopes?: readonly string[]; reason?: string };

/**
 * The login failure for gh, exit 4, with a fix that works. checkLogin, ghApi and git's calls to
 * GitHub all take their words from it. `variables` are the token variables of the login, the one
 * that gh reads first (`tokenVariablesIn`, `tokenVariablesFrom`). The message has two forms:
 *
 * - No variable: run the gh command line, such as `run gh auth login`.
 * - A variable: gh refuses its command line then (note 09, section 1.4). So the message says to
 *   replace the token in the first variable, or give it the missing scopes, or to clear every
 *   variable and then run the command line.
 *
 * Only a variable's name and plain scopes go into the message. Each scope is a caller's constant,
 * or one that gh names and that passes `plainScope`.
 */
export function ghLoginNeeded(
  variables: readonly TokenVariable[],
  fix: GhLoginFix = {},
): CommandError {
  const { scopes = [], reason } = fix;
  const command = scopes.length === 0 ? ghLogin : ghRefresh(scopes);
  const [inUse] = variables;
  if (inUse === undefined) {
    return loginNeeded("gh", { ways: [`run ${command}`], reason });
  }
  const toToken = scopes.length === 0 ? "replace" : `give ${scopesNamed(scopes)} to`;
  const cleared = variables.length === 1 ? inUse : `both ${variables.join(" and ")}`;
  return loginNeeded("gh", {
    ways: [`${toToken} the token in ${inUse}`, `clear ${cleared} and run ${command}`],
    reason,
  });
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

/** The most characters of one text from outside acmelabs that a message or a title shows. */
const shownChars = 300;

/**
 * A text from outside acmelabs, as a failure message, a step's title or detail, or an info message
 * shows it: on one line, cut at 300 characters. Each run of control, format and line-separator
 * characters becomes one space, so no line break, escape sequence or bidi mark reaches the
 * terminal. A cut inside a word drops that word whole: a token or a URL's login part has no space,
 * so no part of one stays for `runCommand`'s redaction of secrets to miss. Such a text is
 * untrusted: GitHub's can echo what a request sent, gh's can hold an answer's body, git's holds
 * GitHub's `remote:` lines, and a folder comes from the caller as given.
 *
 * Each step calls it where it puts such a text into a message, not once on the whole message: the
 * cut applies to the outside text alone, so the fix that the message names after it stays whole.
 */
export function shownText(text: string): string {
  const line = text.replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim();
  // Cut by code points, so the cut never splits a character in two.
  const characters = [...line];
  if (characters.length <= shownChars) {
    return line;
  }
  const kept = characters.slice(0, shownChars).join("");
  // When the text goes on with a word, the kept part's last run of non-space characters may be
  // that word's start, so the run goes; a kept part that ends in a space has no such run.
  const goesOnInWord = /\S/u.test(characters[shownChars] ?? "");
  const whole = goesOnInWord ? kept.replace(/\S+$/u, "") : kept;
  return `${whole.trimEnd()}...`;
}

/**
 * The outside failure for a gh call whose answer ghApi cannot read: an ok answer that is not JSON,
 * or an exit with no GitHub error body, such as a network failure. It names the call, and what gh
 * printed on stderr, as `shownText` gives it.
 */
function unreadable(call: string, spawned: Spawned): CommandError {
  const what =
    spawned.code === 0 ? "gave an answer that is not JSON" : `failed with exit ${spawned.code}`;
  const said = shownText(spawned.stderr);
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
  const tokenVariables = tokenVariablesIn(context.env);
  // gh exits 4 when it has no login at all, before it calls GitHub (note 09, section 1.3).
  if (spawned.code === 4) {
    throw ghLoginNeeded(tokenVariables);
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
    tokenVariables,
  };
}

/** The statuses of `RetriedStatus`, which ghApi checks an answer against. */
const retriedStatuses: ReadonlySet<number> = new Set<RetriedStatus>([404, 409]);

/**
 * How often a call to GitHub is tried again after an answer that a repo made a moment ago can
 * give, and how long the step waits before each try: 3 times, 3 seconds apart, as the spec says.
 * ghApi uses it for an unexpected 404 or 409, and git's calls for "Repository not found".
 */
export const retry = { times: 3, waitMs: 3000 } as const;

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

/** An item of GitHub's `errors`, as its text: a text itself, or an object's `message`. */
function errorText(item: Json | undefined): string | undefined {
  if (typeof item === "string") {
    return item;
  }
  return isJsonObject(item) && typeof item.message === "string" ? item.message : undefined;
}

/**
 * The first error with a text in GitHub's error body, as `shownText` gives it: `errors` as one
 * text, or the first item of the `errors` list that is a text or an object with a `message`, as gh
 * reads them (`parseErrorResponse` in `pkg/cmd/api/api.go` at v2.98.0). A 422 names its cause
 * there, such as "No commits between main and add-brain", while its message says only "Validation
 * Failed". Undefined when the body has none.
 */
function firstErrorOf(body: Json): string | undefined {
  const errors = isJsonObject(body) ? body.errors : undefined;
  let items: readonly (Json | undefined)[] = [];
  if (typeof errors === "string") {
    items = [errors];
  } else if (Array.isArray(errors)) {
    items = errors;
  }
  for (const item of items) {
    const text = shownText(errorText(item) ?? "");
    if (text !== "") {
      return text;
    }
  }
  return undefined;
}

/**
 * GitHub's message in an answer, as a failure shows it: the message, then the body's first error
 * in brackets when it has one, such as `Validation Failed (No commits between main and add-brain)`,
 * each as `shownText` gives it.
 */
function messageWithError(answer: FailedAnswer): string {
  const message = shownText(answer.message);
  const first = firstErrorOf(answer.body);
  return first === undefined ? message : `${message} (${first})`;
}

/**
 * The failure for an answer that a step does not expect, by the spec's table "GitHub's answers and
 * the failure kinds". gh does not tell the login, so a message that names it says "the gh login".
 * A rate limit wins over a missing scope: the limit is what stopped this answer. GitHub answers 404,
 * not 403, to a login that may not write a private resource (note 09, section 2.9), so a 404 on a
 * write names the access, and only a 404 on a read says that GitHub found no repo. A 422 "name
 * already exists" comes from a create whose name another run or a person took after the step's
 * read, or a repo that the login cannot see: an input failure, exit 2. Any other 422 is an outside
 * failure, as the table's other answers are. A message that names GitHub's message names the
 * body's first error too, where a 422 says what failed.
 */
function failureFor(answer: FailedAnswer, repo: GitHubRepo): CommandError {
  const call = `${answer.method} ${answer.path}`;
  const said = messageWithError(answer);
  if (answer.status === 401) {
    return ghLoginNeeded(answer.tokenVariables);
  }
  if (rateLimited(answer)) {
    return outsideError(
      `GitHub's rate limit stopped ${call}; wait, then run the command again (HTTP ${answer.status}): ${said}`,
    );
  }
  if (answer.missingScope !== undefined) {
    return ghLoginNeeded(answer.tokenVariables, { scopes: [answer.missingScope] });
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
      `GitHub refused ${call} for the gh login, which needs more access to ${fullName(repo)} (HTTP 403): ${said}`,
    );
  }
  if (answer.status === 422 && nameTaken(answer.body)) {
    return inputError(
      `GitHub refused ${call} for the gh login: a repo named ${fullName(repo)} already exists, made a moment ago by another run or a person, or hidden from the login (HTTP 422); run the command again, or pick another name`,
    );
  }
  return outsideError(`GitHub answered ${call} with HTTP ${answer.status}: ${said}`);
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
 * in the body, such as `[0].id`. Each place and each issue's message show as `shownText` gives
 * them: a place can hold a key of GitHub's body, and a check's message can quote a value from it.
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
    field: shownText(z.core.toDotPath(issue.path)),
    message: shownText(issue.message),
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
