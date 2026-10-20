import { z } from "zod";

import type { Command } from "./command";
import type { Json } from "./outcome";

/**
 * The command list: every command, whatever its input and its result. A result is JSON, so the
 * list's type holds any command whose result is JSON.
 */
export type CommandList = readonly Command<z.ZodObject, Json>[];

/**
 * The line breaks that Unicode makes mandatory: LF, VT, FF, CR, NEL, and the line and paragraph
 * separators.
 */
const lineBreak = /[\n\v\f\r\u0085\u2028\u2029]/u;

/** A command's name: its path joined by spaces, as `Outcome.command` holds it. */
function nameOf(command: CommandList[number]): string {
  return command.path.join(" ");
}

/** Whether two paths have the same words in the same order. */
function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}

/**
 * Whether `start` is the start of a longer path, word by word, as ["version"] is of
 * ["version", "sync"].
 */
function startsLonger(start: readonly string[], path: readonly string[]): boolean {
  return start.length < path.length && start.every((word, index) => word === path[index]);
}

/**
 * A command's path problems: another command has the same path, or a longer path starts with it.
 */
function pathProblems(command: CommandList[number], list: CommandList): string[] {
  const name = nameOf(command);
  const problems: string[] = [];
  const sharing = list.filter((other) => samePath(other.path, command.path)).length;
  if (sharing > 1) {
    problems.push(`${name}: ${sharing} commands have this path`);
  }
  for (const longer of list.filter((other) => startsLonger(command.path, other.path))) {
    problems.push(`${name}: the path is the start of the path of ${nameOf(longer)}`);
  }
  return problems;
}

/** A command's summary problem: the summary is empty, or more than one line. */
function summaryProblems(command: CommandList[number]): string[] {
  const name = nameOf(command);
  if (command.summary.trim() === "") {
    return [`${name}: the summary is empty`];
  }
  if (lineBreak.test(command.summary)) {
    return [`${name}: the summary is more than one line`];
  }
  return [];
}

/**
 * A command's input fields with no description. The description is the one on the field's own
 * schema, where a question reads it.
 */
function descriptionProblems(command: CommandList[number]): string[] {
  const name = nameOf(command);
  return Object.entries<z.ZodType>(command.input.shape)
    .filter(([, schema]) => (schema.description ?? "").trim() === "")
    .map(([field]) => `${name}: the input field ${field} has no description`);
}

/**
 * Whether a caller may leave a field out: an optional field, or one with a default. An input of
 * this field alone, with the field left out, passes the check, as runCommand checks it.
 */
function mayLeaveOut(schema: z.ZodType): boolean {
  return z.object({ field: schema }).safeParse({}).success;
}

/** A command's positionals that name no input field, or a field that a caller may leave out. */
function positionalProblems(command: CommandList[number]): string[] {
  const name = nameOf(command);
  const { shape } = command.input;
  return (command.positionals ?? []).flatMap((field) => {
    if (!Object.hasOwn(shape, field)) {
      return [`${name}: the positional ${field} names no input field`];
    }
    if (mayLeaveOut(shape[field])) {
      return [`${name}: the positional ${field} names an optional input field`];
    }
    return [];
  });
}

/**
 * The broken rules of a command list, one problem per broken rule, each naming the command by its
 * path. An empty list is a list with no problems.
 */
export function commandListProblems(list: CommandList): string[] {
  const problems = list.flatMap((command) => [
    ...pathProblems(command, list),
    ...summaryProblems(command),
    ...descriptionProblems(command),
    ...positionalProblems(command),
  ]);
  // Two commands with the same path break the rule together: one problem, not one per command.
  return [...new Set(problems)];
}

/**
 * Whether a command file may load a module at its top: zod, a Node built-in (`node:`),
 * command-core (`../command/`) or repo-model (`../repo/`). A Node built-in is light: on Bun 1.4.0
 * it loads faster than zod (median of 15 starts: node:path 8 ms, node:fs/promises 11 ms, zod 20 ms).
 */
function light(specifier: string): boolean {
  return (
    specifier === "zod" ||
    specifier.startsWith("zod/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("../command/") ||
    specifier.startsWith("../repo/")
  );
}

/**
 * The modules a command file loads at its top beyond zod, command-core and repo-model, in the order
 * the file loads them. Bun's own scanner reads the text, as Bun loads it, so a type-only import,
 * which loads nothing, is not one. A module loaded with `await import(...)` loads when the import
 * runs, inside `run`, so it is not one either.
 */
export function heavyImports(text: string): string[] {
  return new Bun.Transpiler({ loader: "ts" })
    .scanImports(text)
    .filter((found) => found.kind !== "dynamic-import")
    .map((found) => found.path)
    .filter((specifier) => !light(specifier));
}
