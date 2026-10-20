import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { editorSchema, schemaFile, schemaText, syncSchema } from "../schema";

let work: string;

/** The JSON Schema node at a dot path, such as `properties.library`. */
function node(schema: unknown, at: string): Record<string, unknown> {
  let current = schema;
  for (const key of at.split(".")) {
    current = (current as Record<string, unknown>)[key];
  }
  return current as Record<string, unknown>;
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "acmelabs-schema-"));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("the shipped schema file", () => {
  test("holds z.toJSONSchema(repoConfigSchema) with the refinements' overrides", async () => {
    expect(await Bun.file(schemaFile).json()).toEqual(editorSchema());
  });

  test("is packages/cli/schema/acmelabs.schema.json, the path in this repo's $schema line", () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../..");
    expect(path.relative(repoRoot, schemaFile)).toBe("packages/cli/schema/acmelabs.schema.json");
  });
});

describe("the overrides for the zod refinements", () => {
  test("at least one repo kind: anyOf requires plugin or library", () => {
    expect(editorSchema().anyOf).toEqual([{ required: ["plugin"] }, { required: ["library"] }]);
  });

  test("no repeats: plugin.hosts and library.packages have uniqueItems", () => {
    expect(editorSchema()).toMatchObject({
      properties: {
        plugin: { properties: { hosts: { uniqueItems: true } } },
        library: { properties: { packages: { uniqueItems: true } } },
      },
    });
  });

  test("no repeats: library.packages says that editors compare paths as written", () => {
    expect(editorSchema()).toMatchObject({
      properties: {
        library: {
          properties: {
            packages: {
              description: expect.stringContaining('"./packages/cli" and "packages/cli"'),
            },
          },
        },
      },
    });
  });

  test("a relative path inside the repo: the pattern rejects '', a leading / and any ..", () => {
    const items = node(editorSchema(), "properties.library.properties.packages.items");
    // JSON Schema patterns are ECMA-262 and match anywhere; editors compile them with the u flag.
    const pattern = new RegExp(String(items.pattern), "u");
    const accepted = [".", "./", "packages/cli", "./packages/cli", "packages/cli/", "..cache"];
    const rejected = ["", "/", "/abs/x", "..", "../sibling", "packages/../..", "packages/../cli"];
    expect(accepted.filter((value) => !pattern.test(value))).toEqual([]);
    expect(rejected.filter((value) => pattern.test(value))).toEqual([]);
  });

  test("a relative path inside the repo: the package path description names the one rule", () => {
    const items = node(editorSchema(), "properties.library.properties.packages.items");
    expect(items.description).toContain('no ".." segment');
    expect(items.description).not.toContain("acmelabs accepts");
  });
});

describe("syncSchema", () => {
  test("check mode passes on a current file and writes nothing", async () => {
    const file = path.join(work, "current.schema.json");
    const text = await Bun.file(schemaFile).text();
    await Bun.write(file, text);
    expect(await syncSchema(file, true)).toEqual({
      failed: false,
      line: `${file}: the schema is current`,
    });
    expect(await Bun.file(file).text()).toBe(text);
  });

  test("check mode fails on a stale file, names the file, and writes nothing", async () => {
    const file = path.join(work, "stale.schema.json");
    const shipped = await Bun.file(schemaFile).text();
    const stale = shipped.replace('"minItems": 1', '"minItems": 2');
    await Bun.write(file, stale);
    expect(await syncSchema(file, true)).toEqual({
      failed: true,
      line: `${file}: the schema is not current; run "bun run schema" to write it`,
    });
    expect(await Bun.file(file).text()).toBe(stale);
  });

  test("check mode fails on a missing file and names the file", async () => {
    const file = path.join(work, "missing.schema.json");
    expect(await syncSchema(file, true)).toEqual({
      failed: true,
      line: `${file}: the schema is not current; run "bun run schema" to write it`,
    });
    expect(await Bun.file(file).exists()).toBe(false);
  });

  test("write mode writes the current text, and a second run finds it current", async () => {
    const file = path.join(work, "written.schema.json");
    await Bun.write(file, "{}\n");
    expect(await syncSchema(file, false)).toEqual({
      failed: false,
      line: `${file}: the schema is written`,
    });
    const text = await Bun.file(file).text();
    expect(text).toBe(await schemaText());
    expect(await syncSchema(file, false)).toEqual({
      failed: false,
      line: `${file}: the schema is current`,
    });
    expect(await Bun.file(file).text()).toBe(text);
  });
});
