/**
 * Write the editor schema from the zod schema.
 *
 *   bun run schema          write packages/cli/schema/acmelabs.schema.json
 *   bun run schema --check  exit 1, naming the file, when it is not current; write nothing
 */
import path from "node:path";

import { format } from "oxfmt";
import { z } from "zod";

// This import moves to @acmelabs/config with the config-presets module.
import formatConfig from "../../../oxfmt.config";
import { repoConfigSchema } from "../src/repo/config";

/** The file of the shipped editor schema, which a repo's `$schema` line points at. */
export const schemaFile = path.resolve(import.meta.dir, "../schema/acmelabs.schema.json");

type JsonSchema = z.core.JSONSchema.BaseSchema;

/**
 * The package path rule of `isRepoRelative` in `src/repo/config.ts`, as one JSON Schema pattern
 * with one lookahead per rule. VS Code compiles it with the `u` flag. A test runs both forms over
 * one list of sample paths, so they stay in step.
 */
const packagePathPattern = [
  // Each lookahead below starts at the start of the path.
  "^",
  // Not blank: not empty, and not only whitespace.
  String.raw`(?!\s*$)`,
  // Not absolute: no "/" at the start.
  "(?!/)",
  // No drive prefix, such as "C:", at the start.
  "(?![A-Za-z]:)",
  // No backslash anywhere. A negated class also matches a line break, where "." does not.
  String.raw`(?![^\\]*\\)`,
  // No NUL character anywhere.
  String.raw`(?![^\x00]*\x00)`,
  // No ".." segment: ".." after the start or a "/", and before a "/" or the end.
  String.raw`(?!(?:[^/]*/)*\.\.(?:/|$))`,
].join("");

/**
 * The JSON Schema form of each zod refinement, which `z.toJSONSchema` leaves out, keyed by the
 * JSON path of the node it joins. Without these, an editor accepts files that readRepoConfig
 * rejects.
 */
const refinements: Readonly<Record<string, JsonSchema>> = {
  // At least one repo kind.
  "": { anyOf: [{ required: ["plugin"] }, { required: ["library"] }] },
  // No repeats. readRepoConfig compares package paths in normal form; JSON Schema cannot.
  "properties.plugin.properties.hosts": { uniqueItems: true },
  "properties.library.properties.packages": {
    uniqueItems: true,
    description:
      'The package folders that publish, as relative paths from the repo root, each one once. Editors compare the paths as written, so "./packages/cli" and "packages/cli" are no repeat to an editor; acmelabs counts them as one.',
  },
  // A relative path inside the repo, the same rule as readRepoConfig's.
  "properties.library.properties.packages.items": {
    pattern: packagePathPattern,
    description:
      'A package folder\'s path from the repo root, with "/" between folders: not blank, not absolute, no drive prefix such as "C:", no backslash or NUL character, and no ".." segment.',
  },
};

/**
 * The editor schema: `z.toJSONSchema(repoConfigSchema)` with the overrides added, by
 * default the refinements. Throws when an override key matches no node, so a renamed field
 * cannot drop its override with no error.
 */
export function editorSchema(
  overrides: Readonly<Record<string, JsonSchema>> = refinements,
): JsonSchema {
  const unmatched = new Set(Object.keys(overrides));
  const schema = z.toJSONSchema(repoConfigSchema, {
    override: ({ jsonSchema, path: at }) => {
      const key = at.join(".");
      Object.assign(jsonSchema, overrides[key]);
      unmatched.delete(key);
    },
  });
  if (unmatched.size > 0) {
    const lines = [...unmatched].map(
      (key) => `the override key ${JSON.stringify(key)} matches no node in the JSON schema`,
    );
    throw new Error(lines.join("\n"));
  }
  return schema;
}

/** The editor schema as file text, formatted as `bun run format` writes it. */
export async function schemaText(): Promise<string> {
  const json = `${JSON.stringify(editorSchema(), null, 2)}\n`;
  const result = await format(path.basename(schemaFile), json, formatConfig);
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.message).join("\n"));
  }
  return result.code;
}

/** One run's result: a line that names the file, and whether the run failed. */
export type SchemaRun = { line: string; failed: boolean };

/** Writes the editor schema to `file` when it is not current; with `check`, fails instead. */
export async function syncSchema(file: string, check: boolean): Promise<SchemaRun> {
  const text = await schemaText();
  const handle = Bun.file(file);
  if ((await handle.exists()) && (await handle.text()) === text) {
    return { line: `${file}: the schema is current`, failed: false };
  }
  if (check) {
    return {
      line: `${file}: the schema is not current; run "bun run schema" to write it`,
      failed: true,
    };
  }
  await Bun.write(file, text);
  return { line: `${file}: the schema is written`, failed: false };
}

if (import.meta.main) {
  const run = await syncSchema(schemaFile, process.argv.includes("--check"));
  if (run.failed) {
    console.error(run.line);
    process.exit(1);
  }
  console.log(run.line);
}
