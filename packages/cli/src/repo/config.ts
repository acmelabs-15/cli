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

/** A non-empty list in which each item appears once; `noun` names an item in the messages. */
function distinctList<Item extends z.ZodType>(item: Item, noun: string) {
  return z
    .array(item)
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
  library: fields({ packages: distinctList(z.string(), "package") }).optional(),
}).refine((config) => config.plugin !== undefined || config.library !== undefined, {
  message: 'neither "plugin" nor "library" is present; declare at least one repo kind',
}) satisfies z.ZodType<RepoConfig>;

function issueLine(file: string, issue: RepoConfigIssue): string {
  return issue.path === ""
    ? `${file}: ${issue.message}`
    : `${file}: ${issue.path}: ${issue.message}`;
}

/** A missing or invalid `acmelabs.json`: the file, and each issue in it. */
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

async function readJson(file: string): Promise<unknown> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) {
    throw new RepoConfigError(file, [
      { path: "", message: 'the file does not exist; create it with "plugin", "library" or both' },
    ]);
  }
  const text = await handle.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RepoConfigError(file, [
      { path: "", message: `the file is not valid JSON: ${reason}` },
    ]);
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
