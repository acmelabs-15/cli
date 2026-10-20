import path from "node:path";

import { z } from "zod";

import { RepoConfigError } from "../repo/config";
import type { Command, Context, ProgressUpdate } from "./command";
import type { CommandFailure, Outcome } from "./outcome";
import { CommandError, exitCodes, inputError } from "./outcome";
import type { World } from "./world";

/** What a front-end gives runCommand: its world, where progress updates go, and its signal. */
export type FrontEnd = {
  world: World;
  progress: (update: ProgressUpdate) => void;
  signal: AbortSignal;
};

/** The time since `started`, a `performance.now()` reading, in whole milliseconds. */
function millisecondsSince(started: number): number {
  return Math.round(performance.now() - started);
}

/** A field's flag: the field in kebab case after two dashes, such as `--dry-run` for `dryRun`. */
function flagOf(field: string): string {
  return `--${field.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
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

/** The context a command runs in: the front-end's world, progress and signal. */
function contextFor<Input>(input: Input, frontEnd: FrontEnd): Context<Input> {
  const { world } = frontEnd;
  return {
    root: world.root,
    env: world.env,
    spawn: world.spawn,
    fetch: world.fetch,
    now: world.now,
    progress(update) {
      frontEnd.progress(update);
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

/** Runs one command: checks the input, runs it, and turns every ending into an Outcome. */
export async function runCommand<Input extends z.ZodObject, Result>(
  command: Command<Input, Result>,
  rawInput: unknown,
  frontEnd: FrontEnd,
): Promise<Outcome<Result>> {
  const started = performance.now();
  const name = command.path.join(" ");
  try {
    const input = await checkInput(command.input, command.positionals ?? [], rawInput);
    const result = await command.run(input, contextFor(input, frontEnd));
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
