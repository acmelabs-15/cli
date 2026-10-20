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
  /** Anything else thrown: a defect in acmelabs itself (BSD's EX_SOFTWARE). */
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

/** How a command ended: its result with exit 0, or its failure with that kind's exit code. */
export type Outcome<Result> =
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

/** A login to `service`, such as gh or npm, is needed: kind `login`, exit 4. */
export function loginNeeded(service: string): CommandError {
  return new CommandError(
    "login",
    `${service} needs a login; log in to ${service}, then run the command again`,
  );
}
