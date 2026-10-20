import path from "node:path";

import type { z } from "zod";

import { RepoConfigError } from "../repo/config";
import type { Command, Context, FrontEnd, ProgressUpdate, Question } from "./command";
import { checkAnswer, checkInput, descriptionOf, flagOf, noValue } from "./input";
import type { CommandFailure, Json, Outcome } from "./outcome";
import { CommandError, exitCodes } from "./outcome";
import { redactorFor } from "./redact";
import { trackSteps } from "./steps";
import type { World } from "./world";

/** The time since `started`, a `performance.now()` reading, in whole milliseconds. */
function millisecondsSince(started: number): number {
  return Math.round(performance.now() - started);
}

/**
 * The world's fetch, with the run's signal unless the command passes its own in the options. A
 * Request keeps its own signal, and takes the run's signal too. The call's limits pass on as they
 * are.
 */
function fetchWithSignal(world: World, signal: AbortSignal): World["fetch"] {
  return (input, init) => {
    const fallback = input instanceof Request ? AbortSignal.any([input.signal, signal]) : signal;
    return world.fetch(input, { ...init, signal: init?.signal ?? fallback });
  };
}

/** The question for one optional input field: its flag, its description and its schema. */
function questionFor(schema: z.ZodObject, field: string): Question {
  const fieldSchema: z.ZodType = schema.shape[field];
  return {
    field,
    flag: flagOf(field),
    description: descriptionOf(fieldSchema),
    schema: fieldSchema,
  };
}

/**
 * The context a command runs in: the front-end's world and signal, the run's progress, and `ask`.
 * `spawn`, `fetch` and `sleep` take the run's signal, so a cancel stops an outside program, a
 * request or a wait; a signal the command passes itself wins.
 * `ask` returns the value given up front; with none, it asks the front-end's `answer` and checks
 * the answer with the field's schema; with no answer either, it is an input error. After a cancel,
 * `ask` rejects with the signal's reason, before the question and after a late answer.
 */
function contextFor<Input>(
  schema: z.ZodObject,
  input: Input,
  frontEnd: FrontEnd,
  progress: (update: ProgressUpdate) => void,
): Context<Input> {
  const { world } = frontEnd;
  return {
    root: world.root,
    env: world.env,
    spawn(commandLine, options) {
      return world.spawn(commandLine, { ...options, signal: options?.signal ?? frontEnd.signal });
    },
    fetch: fetchWithSignal(world, frontEnd.signal),
    now: world.now,
    sleep(ms, options) {
      return world.sleep(ms, { ...options, signal: options?.signal ?? frontEnd.signal });
    },
    progress,
    async ask(field) {
      // A cancelled run asks nothing, so no prompt shows after the outcome.
      frontEnd.signal.throwIfAborted();
      const given = input[field];
      if (given !== undefined && given !== null) {
        return given;
      }
      const question = questionFor(schema, field);
      if (frontEnd.answer === undefined) {
        throw noValue(question);
      }
      // Called through the front-end, so a front-end whose answer is a method keeps its `this`.
      const answer = await frontEnd.answer(question);
      // An answer that comes after a cancel is not used, so the command does not go on with it.
      frontEnd.signal.throwIfAborted();
      const answered = await checkAnswer(question, answer);
      if (answered === undefined || answered === null) {
        throw noValue(question);
      }
      // The field's schema checked the answer, so the answer has the field's type.
      return answered as NonNullable<Input[typeof field]>;
    },
    signal: frontEnd.signal,
  };
}

/** Where a user reports a bug in acmelabs. */
const issuesUrl = "https://github.com/acmelabs-15/cli/issues";

/**
 * The failure behind a thrown value. A CommandError keeps its kind; a RepoConfigError is bad input
 * that keeps its issues at their field paths inside `acmelabs.json`; anything else is a bug in
 * acmelabs, and its message keeps the original text, so the report (or a test author who forgot a
 * fakeWorld answer) sees what broke.
 */
function failureOf(error: unknown): CommandFailure {
  if (error instanceof CommandError) {
    return { kind: error.kind, message: error.message, issues: [...error.issues] };
  }
  if (error instanceof RepoConfigError) {
    // An issue with the whole file has an empty path; it is named by the file's name.
    const fileName = path.basename(error.file);
    return {
      kind: "input",
      message: `${error.file} is not a valid repo config`,
      issues: error.issues.map((issue) => ({
        field: issue.path === "" ? fileName : issue.path,
        message: issue.message,
      })),
    };
  }
  const text = error instanceof Error ? error.message : String(error);
  return {
    kind: "bug",
    message: `acmelabs hit a bug: ${text}. Please report it at ${issuesUrl}`,
    issues: [],
  };
}

/**
 * The work's own ending, or a rejection with the signal's reason as soon as the signal aborts,
 * whichever comes first. The work may go on after an abort, but nothing waits for it.
 */
function untilAborted<Value>(work: Promise<Value>, signal: AbortSignal): Promise<Value> {
  const aborted = Promise.withResolvers<never>();
  function onAbort() {
    aborted.reject(signal.reason);
  }
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return Promise.race([work, aborted.promise]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

/** A progress update with `redact` applied to its title and detail, or to its message text. */
function redactedUpdate(update: ProgressUpdate, redact: (text: string) => string): ProgressUpdate {
  if (update.kind === "message") {
    return { ...update, text: redact(update.text) };
  }
  const { detail } = update;
  const title = redact(update.title);
  return detail === undefined ? { ...update, title } : { ...update, title, detail: redact(detail) };
}

/** A failure with `redact` applied to its message and to each issue's message. */
function redactedFailure(
  failure: CommandFailure,
  redact: (text: string) => string,
): CommandFailure {
  return {
    ...failure,
    message: redact(failure.message),
    issues: failure.issues.map((issue) => ({ ...issue, message: redact(issue.message) })),
  };
}

/**
 * Whether JSON can write the result, as JSON mode's result line must. The Json type stops most
 * results that it cannot; a cycle, or a value typed `any`, gets past the type.
 */
function writable(result: Json): boolean {
  try {
    // JSON.stringify throws on a cycle or a bigint, and gives undefined for a lone function.
    return JSON.stringify(result) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Runs one command: checks the input, runs it, and turns every ending into an Outcome. Every text
 * that leaves it, in a progress update or a failure, has its secrets removed; the result does not.
 */
export async function runCommand<Input extends z.ZodObject, Result extends Json>(
  command: Command<Input, Result>,
  rawInput: unknown,
  frontEnd: FrontEnd,
): Promise<Outcome<Result>> {
  const started = performance.now();
  const name = command.path.join(" ");
  const { signal } = frontEnd;
  const redact = redactorFor(frontEnd.world.env);

  /**
   * Sends one update to the front-end, with its secrets removed. A send that throws, such as a
   * write to a closed pipe, is dropped: the front-end owns its own failure, and the run still ends
   * with its outcome.
   */
  function send(update: ProgressUpdate): void {
    try {
      // Called through the front-end, so a front-end whose progress is a method keeps its `this`.
      frontEnd.progress(redactedUpdate(update, redact));
    } catch {
      // The front-end reports its own failure; the command goes on to its outcome.
    }
  }

  const steps = trackSteps(send);

  /** Checks the input and runs the command, unless the user cancelled before it starts. */
  async function checkAndRun(): Promise<Result> {
    const input = await checkInput(command.input, command.positionals ?? [], rawInput);
    signal.throwIfAborted();
    return command.run(input, contextFor(command.input, input, frontEnd, steps.progress));
  }

  try {
    // A command that ignores the signal does not keep the outcome waiting.
    const result = await untilAborted(checkAndRun(), signal);
    steps.checkEnded();
    // Checked before the outcome, so exit 0 always comes with a result line.
    if (!writable(result)) {
      throw new Error("the command's result cannot be written as JSON");
    }
    return { ok: true, command: name, exitCode: 0, durationMs: millisecondsSince(started), result };
  } catch (error) {
    // No front-end shows a step as running after the command stopped.
    steps.closeAsFailed();
    // Once the user cancels, every failure is the cancel: a closed prompt, a stopped program.
    // A step started again while open is a bug that the run keeps, and it wins over what the
    // command threw after it: a command that caught the bug's error may throw its own failure, and
    // that failure must not hide the bug as a problem or an outside failure.
    const failure: CommandFailure = signal.aborted
      ? { kind: "cancelled", message: "cancelled by the user", issues: [] }
      : failureOf(steps.bug() ?? error);
    return {
      ok: false,
      command: name,
      exitCode: exitCodes[failure.kind],
      durationMs: millisecondsSince(started),
      error: redactedFailure(failure, redact),
    };
  }
}
