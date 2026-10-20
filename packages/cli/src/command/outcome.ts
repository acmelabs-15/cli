/** Each failure kind and its exit code. Agents and CI depend on the codes, so a change is asked. */
export const exitCodes = {
  /** The command ran and found a problem: version drift, a failed validator. */
  problem: 1,
  /** Bad input, a bad `acmelabs.json`, an unanswered question. */
  input: 2,
  /** An outside tool or service failed, or a required tool is missing. */
  outside: 3,
  /** A login is needed (gh, npm). */
  login: 4,
  /** The user cancelled. */
  cancelled: 130,
  /** Anything else thrown: a bug in acmelabs itself (BSD's EX_SOFTWARE). */
  bug: 70,
} as const;

/** How a command failed: one of the kinds in `exitCodes`. */
export type FailureKind = keyof typeof exitCodes;

/** The exit code of a failed command. */
export type ExitCode = (typeof exitCodes)[FailureKind];

/** One issue in a failure: the field it is about, and what is wrong. */
export type Issue = { field: string; message: string };

/** Why a command failed: the kind, a message for people, and the issues behind it. */
export type CommandFailure = { kind: FailureKind; message: string; issues: Issue[] };

/**
 * A value that JSON holds as it is, so a reader of JSON mode's result line gets it back unchanged.
 * An object's field may be undefined, as an optional field is: JSON leaves that field out.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [field: string]: Json | undefined };

/**
 * How a command ended: its result with exit 0, or its failure with that kind's exit code. The
 * result is JSON, because JSON mode's result line carries it.
 */
export type Outcome<Result extends Json> =
  | { ok: true; command: string; exitCode: 0; durationMs: number; result: Result }
  | { ok: false; command: string; exitCode: ExitCode; durationMs: number; error: CommandFailure };

/**
 * A command's failure, thrown to end the command with a failure kind. Commands throw it through the
 * helpers below, so no command picks an exit code by hand; runCommand turns it into an Outcome.
 */
export class CommandError extends Error {
  readonly kind: FailureKind;
  readonly issues: readonly Issue[];

  constructor(kind: FailureKind, message: string, issues: readonly Issue[] = []) {
    super(message);
    this.name = "CommandError";
    this.kind = kind;
    this.issues = issues;
  }
}

/** The command ran and found a problem, such as version drift: kind `problem`, exit 1. */
export function problem(message: string, issues: readonly Issue[] = []): CommandError {
  return new CommandError("problem", message, issues);
}

/** Bad input, a bad `acmelabs.json` or an unanswered question: kind `input`, exit 2. */
export function inputError(message: string, issues: readonly Issue[] = []): CommandError {
  return new CommandError("input", message, issues);
}

/** An outside tool or service failed, or a required tool is missing: kind `outside`, exit 3. */
export function outsideError(message: string, issues: readonly Issue[] = []): CommandError {
  return new CommandError("outside", message, issues);
}

/**
 * A login's fix with more than one way, or with a reason. Each way is a text that the message
 * names, such as `run gh auth login`. The reason says why the login fails, such as the service's
 * own error text; it ends the message, after a colon. A reason with no text adds nothing.
 */
export type LoginFix = { ways: readonly [string, ...string[]]; reason?: string };

/** The LoginFix for loginNeeded's `fix` that is a command line, or none. */
function plainFix(service: string, commandLine: string | undefined): LoginFix {
  return { ways: [commandLine === undefined ? `log in to ${service}` : `run ${commandLine}`] };
}

/**
 * A login to `service`, such as gh or npm, is needed: kind `login`, exit 4. `fix`, when given, is
 * the command line that fixes the login, such as `gh auth login`, and the message names it; or a
 * `LoginFix`, whose ways the message names one after another, then its reason.
 */
export function loginNeeded(service: string, fix?: string | LoginFix): CommandError {
  const { ways, reason } = typeof fix === "object" ? fix : plainFix(service, fix);
  const why = reason === undefined || reason === "" ? "" : `: ${reason}`;
  return new CommandError(
    "login",
    `${service} needs a login; ${ways.join(", or ")}, then run the command again${why}`,
  );
}
