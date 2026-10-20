import { z } from "zod";

import type { Question } from "./command";
import type { CommandError } from "./outcome";
import { inputError } from "./outcome";

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

/** Whether a schema is an optional, nullable or default wrapper around another schema. */
function isWrapper(
  schema: z.core.$ZodType,
): schema is z.ZodOptional | z.ZodNullable | z.ZodDefault {
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  );
}

/**
 * A field's description, given with `.describe()`, found through its optional, nullable and default
 * wrappers: `.describe("x").optional()` and `.optional().describe("x")` both give "x". The list's
 * rules and a question read it here, so both find the same description. The outermost one wins.
 */
export function descriptionOf(schema: z.ZodType): string | undefined {
  let inner: z.core.$ZodType = schema;
  while (z.globalRegistry.get(inner)?.description === undefined && isWrapper(inner)) {
    inner = inner.unwrap();
  }
  return z.globalRegistry.get(inner)?.description;
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
export async function checkInput<Input extends z.ZodObject>(
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
export async function checkAnswer(question: Question, answer: unknown): Promise<unknown> {
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
export function noValue(question: Question): CommandError {
  const example = isBoolean(question.schema) ? question.flag : `${question.flag} <value>`;
  const message = `${question.flag} has no value; give it as a flag, for example ${example}`;
  return inputError(message, [{ field: question.flag, message }]);
}
