import { z } from "zod";

import { descriptionOf } from "./input";
import type { CommandList } from "./list";
import { sameWords } from "./words";

/**
 * The line breaks that Unicode makes mandatory: LF, VT, FF, CR, NEL, and the line and paragraph
 * separators.
 */
const lineBreak = /[\n\v\f\r\u0085\u2028\u2029]/u;

/**
 * A command's name: its path joined by spaces, as `Outcome.command` holds it. A command with an
 * empty path is named `(no path)`, so each of its problems still names it.
 */
function nameOf(command: CommandList[number]): string {
  return command.path.length === 0 ? "(no path)" : command.path.join(" ");
}

/**
 * Whether `start` is the start of a longer path, word by word, as ["version"] is of
 * ["version", "sync"].
 */
function startsLonger(start: readonly string[], path: readonly string[]): boolean {
  return start.length < path.length && start.every((word, index) => word === path[index]);
}

/**
 * A command's path problems: the path is empty, another command has the same path, or a longer
 * path starts with it. An empty path breaks its own rule only, although every path starts with it.
 */
function pathProblems(command: CommandList[number], list: CommandList): string[] {
  const name = nameOf(command);
  if (command.path.length === 0) {
    return [`${name}: the path is empty; a path has one word or more`];
  }
  const problems: string[] = [];
  const sharing = list.filter((other) => sameWords(other.path, command.path)).length;
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
 * A command's input fields with no description. The description is found through the field's
 * optional, nullable and default wrappers, as a question finds it.
 */
function descriptionProblems(command: CommandList[number]): string[] {
  const name = nameOf(command);
  return Object.entries<z.ZodType>(command.input.shape)
    .filter(([, schema]) => (descriptionOf(schema) ?? "").trim() === "")
    .map(([field]) => `${name}: the input field ${field} has no description`);
}

/**
 * Whether a caller may leave a field out: an optional field, or one with a default. An input of
 * this field alone, with the field left out, passes the check, as runCommand checks it: async,
 * because a field with an async check makes a sync check throw.
 */
async function mayLeaveOut(schema: z.ZodType): Promise<boolean> {
  const checked = await z.object({ field: schema }).safeParseAsync({});
  return checked.success;
}

/** A command's positionals that name no input field, or a field that a caller may leave out. */
async function positionalProblems(command: CommandList[number]): Promise<string[]> {
  const name = nameOf(command);
  const { shape } = command.input;
  const problems = await Promise.all(
    (command.positionals ?? []).map(async (field) => {
      if (!Object.hasOwn(shape, field)) {
        return [`${name}: the positional ${field} names no input field`];
      }
      if (await mayLeaveOut(shape[field])) {
        return [`${name}: the positional ${field} names an optional input field`];
      }
      return [];
    }),
  );
  return problems.flat();
}

/**
 * The broken rules of a command list, one problem per broken rule, each naming the command by its
 * path, in the list's order. An empty list is a list with no problems.
 */
export async function commandListProblems(list: CommandList): Promise<string[]> {
  const problems = await Promise.all(
    list.map(async (command) => [
      ...pathProblems(command, list),
      ...summaryProblems(command),
      ...descriptionProblems(command),
      ...(await positionalProblems(command)),
    ]),
  );
  // Two commands with the same path break the rule together: one problem, not one per command.
  return [...new Set(problems.flat())];
}

/**
 * Whether a command file may load a module at its top: zod, a Node built-in (`node:`),
 * command-core (`../command/`), repo-model (`../repo/`) or github-ops's names file
 * (`../github/names`). A Node built-in is light: on Bun 1.4.0 it loads faster than zod (median of
 * 15 starts: node:path 8 ms, node:fs/promises 11 ms, zod 20 ms). github-ops's names file loads
 * only zod, and a command's input checks a repo name with it. Every other github-ops file is
 * heavy, so the rule allows this one specifier, not a prefix.
 */
function light(specifier: string): boolean {
  return (
    specifier === "zod" ||
    specifier.startsWith("zod/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("../command/") ||
    specifier.startsWith("../repo/") ||
    specifier === "../github/names"
  );
}

/**
 * The modules a command file loads at its top beyond the light ones that `light` names, in the
 * order the file loads them. Bun's own scanner reads the text, as Bun loads it, so a type-only
 * import, which loads nothing, is not one. A module loaded with `await import(...)` loads when the
 * import runs, inside `run`, so it is not one either.
 */
export function heavyImports(text: string): string[] {
  return new Bun.Transpiler({ loader: "ts" })
    .scanImports(text)
    .filter((found) => found.kind !== "dynamic-import")
    .map((found) => found.path)
    .filter((specifier) => !light(specifier));
}
