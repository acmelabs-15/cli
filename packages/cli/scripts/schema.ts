/**
 * Write the JSON schema that editors check `acmelabs.json` against, from the zod schema.
 *
 *   bun run schema          write packages/cli/schema/acmelabs.schema.json
 *   bun run schema --check  exit 1, naming the file, when it is not current; write nothing
 */
import path from "node:path";

import { format } from "oxfmt";
import { z } from "zod";

import formatConfig from "../../../oxfmt.config";
import { repoConfigSchema } from "../src/repo/config";

/** The shipped schema file, which a repo's `$schema` line points at. */
export const schemaFile = path.resolve(import.meta.dir, "../schema/acmelabs.schema.json");

type JsonSchema = z.core.JSONSchema.BaseSchema;

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
  // A relative path inside the repo: not empty, no leading "/", no ".." segment. readRepoConfig
  // applies the same rule, so the editor and the command agree.
  "properties.library.properties.packages.items": {
    pattern: String.raw`^(?!/|$)(?!(?:[^/]*/)*\.\.(?:/|$))`,
    description:
      'A package folder\'s path from the repo root: not empty, no leading "/", and no ".." segment.',
  },
};

/** The JSON schema for editors: `z.toJSONSchema(repoConfigSchema)` with the refinements added. */
export function editorSchema(): JsonSchema {
  return z.toJSONSchema(repoConfigSchema, {
    override: ({ jsonSchema, path: at }) => {
      Object.assign(jsonSchema, refinements[at.join(".")]);
    },
  });
}

/** The schema file's text: the JSON schema for editors, formatted as `bun run format` writes it. */
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

/** Writes the schema file when it is not current; with `check`, fails instead of writing. */
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
