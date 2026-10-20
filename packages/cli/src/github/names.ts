import { z } from "zod";

/**
 * A GitHub owner, such as acmelabs-15: 1 to 39 letters, digits or hyphens, and a letter or digit
 * first. An owner goes into an API path, so the check keeps out "/", "%", "." and white space.
 */
export const ownerSchema = z.string().regex(/^[\dA-Za-z][\dA-Za-z-]{0,38}$/u, {
  error: (issue) =>
    `${JSON.stringify(issue.input)} is not a GitHub owner; an owner is 1 to 39 letters, digits or hyphens, and starts with a letter or digit`,
});

/**
 * A GitHub repo's name, such as cli or .github: 1 to 100 letters, digits, ".", "_" or "-", and not
 * "." or "..". A name goes into an API path, so the check keeps out "/", "%", white space and the
 * two path segments that move up or stay.
 */
export const repoNameSchema = z.string().regex(/^(?!\.{1,2}$)[\w.-]{1,100}$/u, {
  error: (issue) =>
    `${JSON.stringify(issue.input)} is not a GitHub repo name; a name is 1 to 100 letters, digits, ".", "_" or "-", and is not "." or ".."`,
});

/** A GitHub repo: its owner, an organization such as acmelabs-15, and its name. */
export type GitHubRepo = { owner: string; name: string };

/** A repo's full name, `owner/name`, as GitHub writes it: acmelabs-15/cli. */
export function fullName(repo: GitHubRepo): string {
  return `${repo.owner}/${repo.name}`;
}
