import { z } from "zod";

import type { Command, Context, ProgressUpdate } from "./command";
import type { CommandFailure, Outcome } from "./outcome";
import { CommandError, exitCodes, inputError } from "./outcome";
import type { World } from "./world";

/** The time since `started`, a `performance.now()` reading, in whole milliseconds. */
function millisecondsSince(started: number): number {
  return Math.round(performance.now() - started);
}

/**
 * The input, checked by the command's schema. Bad input throws an input error, with one issue per
 * zod issue named by zod's field path.
 */
async function checkInput<Input extends z.ZodObject>(
  schema: Input,
  rawInput: unknown,
): Promise<z.infer<Input>> {
  const checked = await schema.safeParseAsync(rawInput);
  if (!checked.success) {
    throw inputError(
      "the input is not valid",
      checked.error.issues.map((issue) => ({
        field: z.core.toDotPath(issue.path),
        message: issue.message,
      })),
    );
  }
  return checked.data;
}

/** The context a command runs in: the front-end's world, progress and signal. */
function contextFor<Input>(
  input: Input,
  host: { world: World; progress: (update: ProgressUpdate) => void; signal: AbortSignal },
): Context<Input> {
  const { world } = host;
  return {
    root: world.root,
    env: world.env,
    spawn: world.spawn,
    fetch: world.fetch,
    now: world.now,
    progress(update) {
      host.progress(update);
    },
    // ask rejects, and never throws, because its type promises a Promise.
    ask(field) {
      const value = input[field];
      if (value === undefined || value === null) {
        return Promise.reject(
          inputError(`the input ${field} has no value`, [
            { field, message: "no value was given; give one when you run the command" },
          ]),
        );
      }
      return Promise.resolve(value);
    },
    signal: host.signal,
  };
}

/** Where a user reports a bug in acmelabs. */
const issuesUrl = "https://github.com/acmelabs-15/cli/issues";

/**
 * The failure behind a thrown value. A CommandError keeps its kind; anything else is a bug in
 * acmelabs, and its message keeps the original text, so the report (or a test author who forgot a
 * fakeWorld answer) sees what broke.
 */
function failureOf(error: unknown): CommandFailure {
  if (error instanceof CommandError) {
    return { kind: error.kind, message: error.message, issues: [...error.issues] };
  }
  const text = error instanceof Error ? error.message : String(error);
  return {
    kind: "bug",
    message: `acmelabs hit a bug: ${text}. Please report it at ${issuesUrl}`,
    issues: [],
  };
}

/** Runs one command: checks the input, runs it, and turns every ending into an Outcome. */
export async function runCommand<Input extends z.ZodObject, Result>(
  command: Command<Input, Result>,
  rawInput: unknown,
  host: { world: World; progress: (update: ProgressUpdate) => void; signal: AbortSignal },
): Promise<Outcome<Result>> {
  const started = performance.now();
  const name = command.path.join(" ");
  try {
    const input = await checkInput(command.input, rawInput);
    const result = await command.run(input, contextFor(input, host));
    return { ok: true, command: name, exitCode: 0, durationMs: millisecondsSince(started), result };
  } catch (error) {
    const failure = failureOf(error);
    return {
      ok: false,
      command: name,
      exitCode: exitCodes[failure.kind],
      durationMs: millisecondsSince(started),
      error: failure,
    };
  }
}
