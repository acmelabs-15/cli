import type { z } from "zod";

import type { Json } from "./outcome";
import type { World } from "./world";

/**
 * One progress update: a step with a stable id and a title for people, or a message. Every started
 * step ends as done, failed or skipped before the command ends; runCommand closes any open step as
 * failed when the command throws. A step may end with no `started` update first.
 */
export type ProgressUpdate =
  | {
      kind: "step";
      step: string;
      title: string;
      status: "started" | "done" | "failed" | "skipped";
      detail?: string;
    }
  | { kind: "message"; level: "info" | "warning"; text: string };

/**
 * The input fields that may have no value: the ones a command asks for mid-run. A required field
 * always has a value once the input is checked, so asking for it says nothing.
 */
export type OptionalField<Input> = {
  [Field in keyof Input]-?: undefined extends Input[Field] ? Field : never;
}[keyof Input] &
  string;

/** What a command runs in: the outside world, progress, questions mid-run, and cancel. */
export type Context<Input> = World & {
  /**
   * Reports one progress update to the front-end. A second `started` update for an open step is a
   * bug in the command: it throws, and the command ends as a bug.
   */
  progress: (update: ProgressUpdate) => void;
  /** The value of an optional input: given up front, asked in a terminal, or an input error. */
  ask: <Field extends OptionalField<Input>>(field: Field) => Promise<NonNullable<Input[Field]>>;
  /** Aborted when the user cancels (Ctrl+C). */
  signal: AbortSignal;
};

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

/**
 * One thing the CLI does, declared once with its inputs. Every front-end reads the declaration. Its
 * result is JSON, because JSON mode's result line carries it.
 */
export type Command<Input extends z.ZodObject, Result extends Json> = {
  /** The words that call it, such as ["version", "sync"]. */
  path: readonly string[];
  /** One line for the help, the TUI's menu and the agent guide. */
  summary: string;
  /**
   * Every input, each field described with `.describe()`. Feeds the flags, the prompts and the MCP
   * tool schema.
   */
  input: Input;
  /** The input fields given by position, in order, such as ["name"] for `acmelabs new <name>`. */
  positionals?: readonly (keyof z.infer<Input> & string)[];
  /** Does the work, and returns the result or throws one of the failure helpers. */
  run: (input: z.infer<Input>, context: Context<z.infer<Input>>) => Promise<Result>;
};

/** Declares a command, with its input and result types inferred from the declaration. */
export function defineCommand<Input extends z.ZodObject, Result extends Json>(
  command: Command<Input, Result>,
): Command<Input, Result> {
  return command;
}
