import path from "node:path";

import { z } from "zod";

import { RepoConfigError } from "../repo/config";
import type { Command, Context, ProgressUpdate } from "./command";
import type { CommandFailure, Json, Outcome } from "./outcome";
import { CommandError, exitCodes, inputError } from "./outcome";
import type { World } from "./world";

/** One question mid-run: what a front-end needs to ask the user for one optional input. */
export type Question = {
  /** The input field the answer fills, such as `marketplace`. */
  field: string;
  /** The field's flag, such as `--marketplace`, the way the caller gives the value up front. */
  flag: string;
  /** The field's description, given with `.describe()`. */
  description: string | undefined;
  /** The field's schema: its type picks the prompt, and runCommand checks the answer with it. */
  schema: z.ZodType;
};

/** How a front-end with a terminal asks one question mid-run. It resolves to the user's answer. */
export type Answerer = (question: Question) => Promise<unknown>;

/**
 * What a front-end gives runCommand: its world, where progress updates go, its signal, and how it
 * asks. JSON mode and the MCP server give no `answer`, so a question with no value is an input
 * error there.
 */
export type FrontEnd = {
  world: World;
  progress: (update: ProgressUpdate) => void;
  signal: AbortSignal;
  answer?: Answerer;
};

/** The time since `started`, a `performance.now()` reading, in whole milliseconds. */
function millisecondsSince(started: number): number {
  return Math.round(performance.now() - started);
}

/**
 * A field's flag: the field in kebab case after two dashes, such as `--dry-run` for `dryRun`. An
 * acronym stays one word: `npmURL` is `--npm-url`. cli-frontend names the router's flags with this
 * function, so an input error always names a flag that exists.
 */
export function flagOf(field: string): string {
  const words = field
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .replaceAll(/(?<acronym>[A-Z])(?<word>[A-Z][a-z])/gu, "$<acronym>-$<word>");
  return `--${words.toLowerCase()}`;
}

/**
 * A zod issue's field, named as the caller wrote it: `<field>` for a positional, else the field's
 * flag, then the rest of zod's path, such as `--tags[1]` or `<tags>[1]`. An issue with the whole
 * input, not one field, has an empty field.
 */
function fieldOf(zodPath: readonly PropertyKey[], positionals: readonly string[]): string {
  const [head] = zodPath;
  if (head === undefined) {
    return "";
  }
  const field = String(head);
  const name = positionals.includes(field) ? `<${field}>` : flagOf(field);
  // The tail is what zod writes after the head: `[1]` for a list item, `.key` for a nested field.
  const tail = z.core.toDotPath(zodPath).slice(z.core.toDotPath([head]).length);
  return name + tail;
}

/**
 * The input, checked by the command's schema. Bad input throws an input error that says how many
 * inputs are wrong, with one issue per zod issue, named as the caller wrote the field.
 */
async function checkInput<Input extends z.ZodObject>(
  schema: Input,
  positionals: readonly string[],
  rawInput: unknown,
): Promise<z.infer<Input>> {
  const checked = await schema.safeParseAsync(rawInput);
  if (!checked.success) {
    const { issues } = checked.error;
    // Two bad items in one list are two issues but one wrong input.
    const wrong = new Set(issues.map((issue) => issue.path[0])).size;
    throw inputError(
      wrong === 1 ? "1 input is not valid" : `${wrong} inputs are not valid`,
      issues.map((issue) => ({ field: fieldOf(issue.path, positionals), message: issue.message })),
    );
  }
  return checked.data;
}

/**
 * The answer to a question mid-run, checked by the field's schema. A bad answer throws an input
 * error with one issue per zod issue, named by the flag.
 */
async function checkAnswer(question: Question, answer: unknown): Promise<unknown> {
  const checked = await question.schema.safeParseAsync(answer);
  if (!checked.success) {
    throw inputError(
      `the answer to ${question.flag} is not valid`,
      checked.error.issues.map((issue) => ({
        field: fieldOf([question.field, ...issue.path], []),
        message: issue.message,
      })),
    );
  }
  return checked.data;
}

/** Whether a field takes a boolean, under its optional and nullable wrappers. */
function isBoolean(schema: z.ZodType): boolean {
  let inner: z.core.$ZodType = schema;
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
    inner = inner.unwrap();
  }
  return inner instanceof z.ZodBoolean;
}

/**
 * The input error for a question with no value: it names the flag, and shows how to give the value
 * as a flag. A boolean flag takes no value; any other flag takes one.
 */
function noValue(question: Question): CommandError {
  const example = isBoolean(question.schema) ? question.flag : `${question.flag} <value>`;
  const message = `${question.flag} has no value; give it as a flag, for example ${example}`;
  return inputError(message, [{ field: question.flag, message }]);
}

/** The open steps of one run, and the progress that opens and ends them. */
type Steps = {
  /**
   * Sends one update on to the front-end, and keeps track of which steps are open. A second
   * `started` update for an open step is not sent: it throws the run's defect.
   */
  progress: (update: ProgressUpdate) => void;
  /** The run's defect, if any: a step started again while it was open. */
  defect: () => Error | undefined;
  /**
   * At the command's normal end, throws the run's defect, or one that names each open step. After
   * it, progress sends nothing on, so work the command did not wait for is not heard after the
   * outcome, and the result stays JSON mode's last line.
   */
  checkEnded: () => void;
  /**
   * Sends a `failed` update for each open step, in the order the steps started. After it, progress
   * sends nothing on, so a command that ignores the signal is not heard after its outcome.
   */
  closeAsFailed: () => void;
};

/**
 * The steps of one run. A step is open from its `started` update until a `done`, `failed` or
 * `skipped` update for the same step id. A step may also end with no `started` update first, as a
 * step that finishes at once or is skipped does. A step started again while it is open is a defect
 * in the command, because a front-end would show the step twice.
 */
function trackSteps(send: (update: ProgressUpdate) => void): Steps {
  /** Each open step's title by its step id, in the order the steps started. */
  const open = new Map<string, string>();
  // Kept, and not only thrown, so a command that catches it still ends as a bug.
  let restarted: Error | undefined;
  let closed = false;
  return {
    progress(update) {
      if (closed) {
        return;
      }
      if (update.kind === "step") {
        if (update.status !== "started") {
          open.delete(update.step);
        } else if (open.has(update.step)) {
          restarted ??= new Error(
            `the command started step ${update.step} again while it was still open`,
          );
          throw restarted;
        } else {
          open.set(update.step, update.title);
        }
      }
      send(update);
    },
    defect: () => restarted,
    checkEnded() {
      closed = true;
      if (restarted !== undefined) {
        throw restarted;
      }
      if (open.size > 0) {
        const ids = [...open.keys()];
        const noun = ids.length === 1 ? "step" : "steps";
        throw new Error(`the command ended with ${noun} ${ids.join(", ")} still open`);
      }
    },
    closeAsFailed() {
      for (const [step, title] of open) {
        send({ kind: "step", step, title, status: "failed" });
      }
      open.clear();
      closed = true;
    },
  };
}

/**
 * The world's fetch, with the run's signal unless the command passes its own in the options. A
 * Request keeps its own signal, and takes the run's signal too.
 */
function fetchWithSignal(world: World, signal: AbortSignal): World["fetch"] {
  function signalled(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const fallback = input instanceof Request ? AbortSignal.any([input.signal, signal]) : signal;
    return world.fetch(input, { ...init, signal: init?.signal ?? fallback });
  }
  return Object.assign(signalled, {
    preconnect(...args: Parameters<World["fetch"]["preconnect"]>) {
      world.fetch.preconnect(...args);
    },
  });
}

/**
 * The context a command runs in: the front-end's world and signal, the run's progress, and `ask`.
 * `spawn` and `fetch` take the run's signal, so a cancel stops an outside program or request; a
 * signal the command passes itself wins.
 * `ask` returns the value given up front; with none, it asks the front-end's `answer` and checks
 * the answer with the field's schema; with no answer either, it is an input error.
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
    progress,
    async ask(field) {
      // A cancelled run asks nothing, so no prompt shows after the outcome.
      frontEnd.signal.throwIfAborted();
      const given = input[field];
      if (given !== undefined && given !== null) {
        return given;
      }
      const fieldSchema: z.ZodType = schema.shape[field];
      const question = {
        field,
        flag: flagOf(field),
        description: fieldSchema.description,
        schema: fieldSchema,
      };
      // Called through the front-end, so a front-end whose answer is a method keeps its `this`.
      const answered =
        frontEnd.answer === undefined
          ? undefined
          : await checkAnswer(question, await frontEnd.answer(question));
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

/** Runs one command: checks the input, runs it, and turns every ending into an Outcome. */
export async function runCommand<Input extends z.ZodObject, Result extends Json>(
  command: Command<Input, Result>,
  rawInput: unknown,
  frontEnd: FrontEnd,
): Promise<Outcome<Result>> {
  const started = performance.now();
  const name = command.path.join(" ");
  const { signal } = frontEnd;
  // Called through the front-end, so a front-end whose progress is a method keeps its `this`.
  const steps = trackSteps((update) => frontEnd.progress(update));

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
    // Once the user cancels, every failure is the cancel: a closed prompt, a stopped program. A
    // defect in the command's progress wins over what the command threw after it.
    const failure: CommandFailure = signal.aborted
      ? { kind: "cancelled", message: "cancelled by the user", issues: [] }
      : failureOf(steps.defect() ?? error);
    return {
      ok: false,
      command: name,
      exitCode: exitCodes[failure.kind],
      durationMs: millisecondsSince(started),
      error: failure,
    };
  }
}
