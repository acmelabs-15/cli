import { stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { HostId } from "./hosts";
import { hostIds } from "./hosts";

/** A repo's kinds, and for a plugin repo its hosts, as `acmelabs.json` declares them. */
export type RepoConfig = {
  plugin?: { hosts: HostId[] };
  library?: { packages: string[] };
};

/** One problem in a repo config: the field path (empty for the whole file) and what is wrong. */
export type RepoConfigIssue = { path: string; message: string };

const host = z.enum(hostIds, {
  error: (issue) =>
    `${JSON.stringify(issue.input)} is not a host; the hosts are ${hostIds.join(", ")}`,
});

/** A path in normal form: `.` and `..` segments resolved, no `/` at the end. */
function normalForm(value: string): string {
  const normal = path.posix.normalize(value);
  return normal.length > 1 && normal.endsWith("/") ? normal.slice(0, -1) : normal;
}

/** A Windows drive prefix, such as `C:`, at the start of a path. */
const drivePrefix = /^[A-Za-z]:/u;

/**
 * Whether a path is relative and inside the repo, as written: not blank, not absolute, no drive
 * prefix, no backslash or NUL character, and no `..` segment. The editor schema's `pattern` in
 * `scripts/schema.ts` is the same rule; `scripts/__tests__/schema.test.ts` keeps the two in step.
 */
function isRepoRelative(value: string): boolean {
  return (
    value.trim() !== "" &&
    !path.posix.isAbsolute(value) &&
    !drivePrefix.test(value) &&
    !value.includes("\\") &&
    !value.includes("\u0000") &&
    !value.split("/").includes("..")
  );
}

/** A package folder's path from the repo root, checked as written, then put in normal form. */
const packagePath = z
  .string()
  .refine(isRepoRelative, {
    error: (issue) =>
      `${JSON.stringify(issue.input)} is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment`,
  })
  .overwrite(normalForm);

/** A required, non-empty list in which each item appears once; `noun` names an item in messages. */
function distinctList<Item extends z.ZodType>(item: Item, noun: string) {
  return z
    .array(item, {
      error: (issue) =>
        issue.input === undefined ? `the field is missing; name at least one ${noun}` : undefined,
    })
    .min(1, `the list is empty; name at least one ${noun}`)
    .superRefine((items, context) => {
      for (const [index, value] of items.entries()) {
        if (items.indexOf(value) !== index) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `${JSON.stringify(value)} is already in the list; name each ${noun} once`,
          });
        }
      }
    });
}

/** An object that allows only these fields; an unknown field's message lists them. */
function fields<Shape extends z.ZodRawShape>(shape: Shape) {
  const names = Object.keys(shape).join(", ");
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? `unknown field; the fields are ${names}` : undefined,
  });
}

/** The rules of `acmelabs.json`. The file's own `$schema` line is the one extra field allowed. */
export const repoConfigSchema = fields({
  $schema: z.string().optional(),
  plugin: fields({ hosts: distinctList(host, "host") }).optional(),
  library: fields({ packages: distinctList(packagePath, "package") }).optional(),
}).refine((config) => config.plugin !== undefined || config.library !== undefined, {
  message: 'neither "plugin" nor "library" is present; declare at least one repo kind',
}) satisfies z.ZodType<RepoConfig>;

function issueLine(file: string, issue: RepoConfigIssue): string {
  return issue.path === ""
    ? `${file}: ${issue.message}`
    : `${file}: ${issue.path}: ${issue.message}`;
}

/** A missing, unreadable or invalid `acmelabs.json`: the file, and each issue in it. */
export class RepoConfigError extends Error {
  readonly file: string;
  readonly issues: readonly RepoConfigIssue[];

  constructor(file: string, issues: readonly RepoConfigIssue[]) {
    super(issues.map((issue) => issueLine(file, issue)).join("\n"));
    this.name = "RepoConfigError";
    this.file = file;
    this.issues = issues;
  }
}

/** The largest repo config read, 1 MiB, so a hostile repo cannot make the CLI read a huge file. */
const maxFileSize = 1_048_576;

/** A RepoConfigError for a problem with the whole file, not with one field. */
function fileError(file: string, message: string): RepoConfigError {
  return new RepoConfigError(file, [{ path: "", message }]);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Checks that `file` is a regular file of at most 1 MiB, before any read. */
async function checkFile(file: string): Promise<void> {
  const stats = await stat(file).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw fileError(file, 'the file does not exist; create it with "plugin", "library" or both');
    }
    throw fileError(file, `the file cannot be read: ${reasonOf(error)}`);
  });
  if (stats.isDirectory()) {
    throw fileError(file, "the path is a folder, not a file; acmelabs.json must be a file");
  }
  // A device such as /dev/zero reports size 0 and never ends, so only a regular file is read.
  if (!stats.isFile()) {
    throw fileError(file, "the file cannot be read: it is not a regular file");
  }
  if (stats.size > maxFileSize) {
    throw fileError(file, "the file is larger than 1 MiB; a repo config is a few lines");
  }
}

async function readJson(file: string): Promise<unknown> {
  await checkFile(file);
  const text = await Bun.file(file)
    .text()
    .catch((error: unknown) => {
      throw fileError(file, `the file cannot be read: ${reasonOf(error)}`);
    });
  try {
    return JSON.parse(text);
  } catch (error) {
    throw fileError(file, `the file is not valid JSON: ${reasonOf(error)}`);
  }
}

/** One issue per field: an unknown-field issue that names several keys becomes one per key. */
function schemaIssues(issue: z.core.$ZodIssue): RepoConfigIssue[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: z.core.toDotPath([...issue.path, key]),
      message: issue.message,
    }));
  }
  return [{ path: z.core.toDotPath(issue.path), message: issue.message }];
}

/** Reads and checks <root>/acmelabs.json. Throws RepoConfigError naming the file and each issue. */
export async function readRepoConfig(root: string): Promise<RepoConfig> {
  const file = path.join(root, "acmelabs.json");
  const result = repoConfigSchema.safeParse(await readJson(file));
  if (!result.success) {
    throw new RepoConfigError(file, result.error.issues.flatMap(schemaIssues));
  }
  const { $schema: _schema, ...config } = result.data;
  return config;
}

/** A list of strings as one line of JSON, spaced as the formatter writes it: `["a", "b"]`. */
function jsonList(items: readonly string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
}

/** The canonical file text: two-space JSON, the $schema line first, a final newline. */
export function formatRepoConfig(config: RepoConfig, schemaPath: string): string {
  const lines = [`"$schema": ${JSON.stringify(schemaPath)}`];
  if (config.plugin !== undefined) {
    lines.push(`"plugin": { "hosts": ${jsonList(config.plugin.hosts)} }`);
  }
  if (config.library !== undefined) {
    lines.push(`"library": { "packages": ${jsonList(config.library.packages)} }`);
  }
  return `{\n${lines.map((line) => `  ${line}`).join(",\n")}\n}\n`;
}
