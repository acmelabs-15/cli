import type { z } from "zod";

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

/** What a command runs in: the outside world, progress, questions mid-run, and cancel. */
export type Context<Input> = World & {
  /**
   * Reports one progress update to the front-end. A second `started` update for an open step is a
   * defect: it throws, and the command ends as a bug.
   */
  progress: (update: ProgressUpdate) => void;
  /** The value of an optional input: given up front, asked in a terminal, or an input error. */
  ask: <Field extends keyof Input & string>(field: Field) => Promise<NonNullable<Input[Field]>>;
  /** Aborted when the user cancels (Ctrl+C). */
  signal: AbortSignal;
};

/** One thing the CLI does, declared once with its inputs. Every front-end reads the declaration. */
export type Command<Input extends z.ZodObject, Result> = {
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
export function defineCommand<Input extends z.ZodObject, Result>(
  command: Command<Input, Result>,
): Command<Input, Result> {
  return command;
}
