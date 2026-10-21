import { z } from "zod";

/**
 * The characters that JSON.stringify leaves raw although a terminal acts on them or hides them:
 * DEL and the C1 controls (U+009B starts an escape sequence in some terminals), the format
 * characters, such as the bidi mark U+202E, and the line and paragraph separators.
 */
const leftRawByJson = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * One character as JSON escapes it: `\uXXXX` for each of its UTF-16 code units, in lower case as
 * JSON.stringify writes them, so a character past U+FFFF gives two escapes, and JSON reads the
 * escapes back as the character.
 */
function jsonEscape(character: string): string {
  let escaped = "";
  for (let index = 0; index < character.length; index += 1) {
    // at() gives one code unit, and codePointAt reads a lone surrogate as itself; the index is
    // inside the character, so a unit is always there.
    const unit = character.at(index)?.codePointAt(0) ?? 0;
    escaped += `\\u${unit.toString(16).padStart(4, "0")}`;
  }
  return escaped;
}

/**
 * A value that a check refuses, as a message shows it: quoted as JSON writes it, and beyond JSON,
 * each control, format, line-separator or paragraph-separator character that JSON leaves raw as
 * its `\uXXXX` escape, such as `\u202e` for a bidi mark. So no such character reaches the
 * terminal, and JSON reads the text back as the value. It lives in names.ts, which loads only zod,
 * so that names.ts's own checks can use it and a command file still loads names.ts at its top.
 */
export function quoted(value: string): string {
  return JSON.stringify(value).replaceAll(leftRawByJson, jsonEscape);
}

/**
 * A GitHub owner, such as acmelabs-15: 1 to 39 letters, digits or hyphens, and a letter or digit
 * first. An owner goes into an API path, so the check keeps out "/", "%", "." and white space.
 */
export const ownerSchema = z.string().regex(/^[\dA-Za-z][\dA-Za-z-]{0,38}$/u, {
  error: (issue) =>
    `${quoted(String(issue.input))} is not a GitHub owner; an owner is 1 to 39 letters, digits or hyphens, and starts with a letter or digit`,
});

/**
 * A GitHub repo's name, such as cli or .github: 1 to 100 letters, digits, ".", "_" or "-", and not
 * "." or "..". A name goes into an API path, so the check keeps out "/", "%", white space and the
 * two path segments that move up or stay.
 */
export const repoNameSchema = z.string().regex(/^(?!\.{1,2}$)[\w.-]{1,100}$/u, {
  error: (issue) =>
    `${quoted(String(issue.input))} is not a GitHub repo name; a name is 1 to 100 letters, digits, ".", "_" or "-", and is not "." or ".."`,
});

/** A GitHub repo: its owner, an organization such as acmelabs-15, and its name. */
export type GitHubRepo = { owner: string; name: string };

/** A repo's full name, `owner/name`, as GitHub writes it: acmelabs-15/cli. */
export function fullName(repo: GitHubRepo): string {
  return `${repo.owner}/${repo.name}`;
}
