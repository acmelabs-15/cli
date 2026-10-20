import type { ProgressUpdate } from "./command";
import type { Json, Outcome } from "./outcome";

/**
 * The characters that JSON.stringify leaves raw although they are control characters or line
 * breaks: DEL, the C1 controls (NEL among them), and the Unicode line and paragraph separators.
 */
const leftRaw = /[\u007F-\u009F\u2028\u2029]/gu;

/** One character as a JSON escape, in JSON.stringify's own form, such as `\u0085` for NEL. */
function escapeOf(character: string): string {
  // The pattern matches one character at a time, so the character always has a code point.
  const code = character.codePointAt(0) ?? 0;
  return `\\u${code.toString(16).padStart(4, "0")}`;
}

/**
 * A value as one line of JSON: every control character and line break inside a string is escaped,
 * so the line holds no line break, and a reader gets the same value back.
 */
function oneLine(value: Json): string {
  return JSON.stringify(value).replaceAll(leftRaw, escapeOf);
}

/**
 * JSON mode's line for one progress update: a `progress` line for a step, a `message` line for a
 * message. `command` is the command's name, its path joined by spaces, as `Outcome.command` holds it.
 * Each field is named in the spec's order, so a script can compare the lines of two runs.
 */
export function progressLine(command: string, update: ProgressUpdate): string {
  if (update.kind === "step") {
    const { step, title, status, detail } = update;
    // JSON leaves out a field whose value is undefined, so a step with no detail has no detail field.
    return oneLine({ type: "progress", command, step, title, status, detail });
  }
  const { level, text } = update;
  return oneLine({ type: "message", command, level, text });
}

/** JSON mode's last line: how the command ended, with its result or its error. */
export function resultLine(outcome: Outcome<Json>): string {
  const { command, exitCode, durationMs } = outcome;
  if (outcome.ok) {
    const { result } = outcome;
    return oneLine({ type: "result", command, ok: true, exitCode, durationMs, result });
  }
  const { kind, message, issues } = outcome.error;
  // Each field named, so an issue that carries more fields, or the fields in another order, keeps
  // the line's shape.
  const error = {
    kind,
    message,
    issues: issues.map((issue) => ({ field: issue.field, message: issue.message })),
  };
  return oneLine({ type: "result", command, ok: false, exitCode, durationMs, error });
}
