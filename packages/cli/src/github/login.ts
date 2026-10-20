import { z } from "zod";

import type { LoginFix } from "../command/outcome";
import { loginNeeded, outsideError } from "../command/outcome";
import type { Spawned } from "../command/world";
import type { StepContext } from "./gh";
import { ghLogin, ghRefresh, shownText } from "./gh";

/** The gh login that checkLogin checked: its login name, and the scopes its token reports. */
export type CheckedLogin = { login: string; scopes: readonly string[] };

/**
 * The command line that reads gh's login for github.com as JSON. Without `--show-token`, gh leaves
 * the token out of the answer (note 09, section 1.4).
 */
const statusCommandLine = [
  "gh",
  "auth",
  "status",
  "--hostname",
  "github.com",
  "--json",
  "hosts",
] as const;

/** The command line as one text, as a failure's message names it. */
const statusCall = statusCommandLine.join(" ");

/**
 * The variables every gh call adds: gh asks nothing, and prints no notice of a new release. The
 * same two as `ghApi` adds in gh.ts.
 */
const ghEnv = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" } as const;

/**
 * One account in gh's answer: the fields that the step reads. gh leaves out `scopes` for a token
 * that reports none, and `error` for an account in the state `success` (`authEntry` in
 * `pkg/cmd/auth/status/status.go` at v2.98.0). gh always gives `tokenSource`, such as `keyring` or
 * `GH_TOKEN`; the step reads it only to word a failure, so an answer without it still passes.
 */
const accountBody = z.object({
  active: z.boolean(),
  state: z.string(),
  login: z.string(),
  tokenSource: z.string().optional(),
  scopes: z.string().optional(),
  error: z.string().optional(),
});

/** One account in gh's answer, as the step reads it. */
type Account = z.output<typeof accountBody>;

/** gh's answer: the accounts of each host, the active one first. No host, no login. */
const statusBody = z.object({ hosts: z.record(z.string(), z.array(accountBody)) });

/**
 * gh's answer, read with its schema. gh's exit 4 means that it needs a login. Any other exit, an
 * answer that is not JSON, or an answer of another shape is an outside failure that names the
 * command line, and what gh printed on stderr or the first thing wrong. With `--json`, gh exits 0
 * when it has no login too, so exit 0 is the normal answer.
 */
function readStatus(spawned: Spawned): z.output<typeof statusBody> {
  if (spawned.code === 4) {
    throw loginNeeded("gh", ghLogin);
  }
  const stderrNote = spawned.stderr.trim() === "" ? "" : `: ${spawned.stderr.trim()}`;
  if (spawned.code !== 0) {
    throw outsideError(`${statusCall} failed with exit ${spawned.code}${stderrNote}`);
  }
  let answer: unknown;
  try {
    answer = JSON.parse(spawned.stdout);
  } catch {
    throw outsideError(`${statusCall} gave an answer that is not JSON${stderrNote}`);
  }
  const read = statusBody.safeParse(answer);
  if (read.success) {
    return read.data;
  }
  const issues = read.error.issues.map((issue) => ({
    field: z.core.toDotPath(issue.path),
    message: issue.message,
  }));
  // zod gives at least one issue for an answer it cannot read.
  const [first = { field: "", message: "" }] = issues;
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : "";
  const place = first.field === "" ? "" : `${first.field}: `;
  throw outsideError(
    `${statusCall} gave an answer that acmelabs cannot read: ${place}${first.message}${more}`,
    issues,
  );
}

/** The scopes in gh's `scopes` text, such as `gist, repo`, as a list. No text, no scopes. */
function scopesOf(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope !== "");
}

/**
 * Each scope that includes other scopes, and the scopes it includes: repo includes public_repo,
 * not the other way (GitHub's "Scopes for OAuth apps"). GitHub saves a token's scopes without those
 * that another of its scopes includes, so a token with repo lists repo alone. gh's own check
 * counts admin:org and write:org as read:org (`pkg/cmd/auth/shared/oauth_scopes.go` at v2.98.0).
 * The map holds the groups of repo and read:org only; a step that asks for a scope of another
 * group, such as read:user, adds that group here from GitHub's list.
 */
const includedScopes: ReadonlyMap<string, readonly string[]> = new Map([
  ["repo", ["repo:status", "repo_deployment", "public_repo", "repo:invite", "security_events"]],
  ["admin:org", ["write:org", "read:org"]],
  ["write:org", ["read:org"]],
]);

/** Whether a token with these scopes holds the asked scope: itself, or a scope that includes it. */
function holds(scopes: readonly string[], asked: string): boolean {
  return scopes.some((scope) => scope === asked || includedScopes.get(scope)?.includes(asked));
}

/** The scopes as a message names them: "the workflow scope", or "the repo and workflow scopes". */
function scopesNamed(scopes: readonly string[]): string {
  const list = new Intl.ListFormat("en").format(scopes);
  return scopes.length === 1 ? `the ${list} scope` : `the ${list} scopes`;
}

/**
 * The variables from which gh reads a token for github.com, GH_TOKEN before GITHUB_TOKEN (note 09,
 * section 1.2). An account whose `tokenSource` is one of them has its token from that variable.
 */
const tokenVariables: ReadonlySet<string> = new Set(["GH_TOKEN", "GITHUB_TOKEN"]);

/**
 * The ways to fix the account's login, whose gh command line is `command`. gh auth login and gh
 * auth refresh refuse to run while the token comes from a variable (note 09, section 1.4), so for
 * such a token the ways are to do `toToken` to it, such as "replace" for "replace the token in
 * GH_TOKEN", or to clear the variable, then run the command line. Only a name in `tokenVariables`
 * goes into the message, never other text from gh.
 */
function waysToFix(account: Account, command: string, toToken: string): LoginFix["ways"] {
  const variable = account.tokenSource;
  if (variable === undefined || !tokenVariables.has(variable)) {
    return [`run ${command}`];
  }
  return [`${toToken} the token in ${variable}`, `clear ${variable} and run ${command}`];
}

/**
 * Checks gh's login for github.com before any write, so a missing scope shows before a half-made
 * repo. It reads the active account, the one that every gh call and gh's git helper use, also
 * when its token comes from GH_TOKEN. No account, or a state of `error`, is a login failure that
 * names `gh auth login`; a state of `error` adds gh's own error text, because it covers a token
 * that GitHub rejects and a network failure alike. A state of `timeout` is gh's request to GitHub
 * timing out: an outside failure, exit 3. When the token reports scopes and one of the asked
 * scopes is missing, it is a login failure that names `gh auth refresh` with every missing scope.
 * For a token from GH_TOKEN or GITHUB_TOKEN, a login failure names the variable too: gh refuses
 * those two command lines while it is set, so the message says to change that token, or to clear
 * the variable first. A token that reports no scopes, a fine-grained or app token, skips the scope
 * check, as gh does. The asked scopes are the caller's own constants, such as repo and workflow:
 * they go into that command line as they are, so no text from gh or from the user goes there.
 */
export async function checkLogin(
  context: StepContext,
  options: { scopes: readonly string[] },
): Promise<CheckedLogin> {
  const step = {
    kind: "step",
    step: "github-login",
    title: "Check the gh login for github.com",
  } as const;
  context.progress({ ...step, status: "started" });
  const status = readStatus(await context.spawn(statusCommandLine, { env: ghEnv }));
  const account = status.hosts["github.com"]?.find((entry) => entry.active);
  if (account?.state === "timeout") {
    throw outsideError(
      `${statusCall} timed out on its way to GitHub; check the network, then run the command again: ${shownText(account.error ?? "no message")}`,
    );
  }
  if (account === undefined) {
    throw loginNeeded("gh", ghLogin);
  }
  if (account.state !== "success") {
    // The state `error` covers a token that GitHub rejects and a network failure alike (gh's
    // buildEntry), so gh's own error text shows the user the cause. That text names gh's request
    // and GitHub's answer; it holds no token, which gh sends only in a header.
    throw loginNeeded("gh", {
      ways: waysToFix(account, ghLogin, "replace"),
      reason: shownText(account.error ?? ""),
    });
  }
  const { login } = account;
  const scopes = scopesOf(account.scopes);
  const missing = options.scopes.filter((asked) => !holds(scopes, asked));
  // A token that reports no scopes has permissions instead, which gh does not check either.
  if (scopes.length > 0 && missing.length > 0) {
    // gh auth refresh takes several scopes in one --scopes, with commas between them.
    const fix = ghRefresh(missing.join(","));
    throw loginNeeded("gh", {
      ways: waysToFix(account, fix, `give ${scopesNamed(missing)} to`),
    });
  }
  const shown = scopes.length === 0 ? "a token that reports no scopes" : scopes.join(", ");
  context.progress({ ...step, status: "done", detail: `${login}, with ${shown}` });
  return { login, scopes };
}
