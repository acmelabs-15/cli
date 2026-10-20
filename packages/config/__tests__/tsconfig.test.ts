import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ts from "typescript";

import {
  builtPackage,
  realNodeLine,
  sampleRepo,
  typescriptThinCaller,
} from "../src/__tests__/sample-repo";

let work: string;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "acmelabs-config-tsconfig-"));
  // The first call builds the package, which can take longer than the default 5 s.
  await builtPackage();
}, 30_000);

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/** The TypeScript preset, which the package ships as it is. */
const presetPath = path.join(import.meta.dir, "../tsconfig.json");

/** The preset's text, read as tsc reads it: JSON with comments. Throws when tsc cannot read it. */
async function readPreset(): Promise<{ text: string; config: Record<string, unknown> }> {
  const text = await Bun.file(presetPath).text();
  const { config, error } = ts.parseConfigFileTextToJson(presetPath, text);
  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  }
  return { text, config: config as Record<string, unknown> };
}

describe("the TypeScript preset's text", () => {
  test("it holds the spec's compilerOptions", async () => {
    const { config } = await readPreset();
    expect(config.compilerOptions).toEqual({
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ESNext"],
      types: ["bun"],
      strict: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
      verbatimModuleSyntax: true,
    });
  });

  test("every option under compilerOptions has a comment line directly above it", async () => {
    const { text, config } = await readPreset();
    const lines = text.split("\n");
    const options = Object.keys(config.compilerOptions as Record<string, unknown>);
    const withoutComment = options.filter((option) => {
      const index = lines.findIndex((line) => line.trim().startsWith(`"${option}":`));
      const above = lines[index - 1]?.trim() ?? "";
      return index < 1 || !/^\/\/\s*\S/u.test(above);
    });
    expect(withoutComment).toEqual([]);
  });

  test("it has no include: a path in an extended config resolves from the preset's own folder", async () => {
    const { config } = await readPreset();
    expect(config).not.toHaveProperty("include");
  });
});

/** Each error that tsc lists, as its file and its code, in the order tsc prints them. */
function errorsOf(output: string): string[] {
  return [...output.matchAll(/^(?<file>\S+)\(\d+,\d+\): error (?<code>TS\d+):/gmu)].map(
    ({ groups }) => `${groups?.file} ${groups?.code}`,
  );
}

/** An index read on a `string[]`: with noUncheckedIndexedAccess, `values[0]` can be undefined. */
const uncheckedIndexRead = [
  "export function firstLength(values: string[]): number {",
  "  return values[0].length;",
  "}",
  "",
].join("\n");

describe("bun run typecheck in a sample repo with the tsconfig.json thin caller", () => {
  test("Bun.file type-checks, an unchecked index read and a type-only import without type fail, and a file outside include is not checked", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "tsconfig.json": typescriptThinCaller,
        "src/read.ts": [
          "export function readName(file: string): Promise<string> {",
          "  return Bun.file(file).text();",
          "}",
          "",
        ].join("\n"),
        "src/first-length.ts": uncheckedIndexRead,
        "src/shape.ts": "export type Shape = { name: string };\n",
        "src/name.ts": [
          'import { Shape } from "./shape";',
          "",
          "export function nameOf(shape: Shape): string {",
          "  return shape.name;",
          "}",
          "",
        ].join("\n"),
        // The same index read, outside the thin caller's include.
        "scripts/first-length.ts": uncheckedIndexRead,
      },
    });
    const run = await repo.run("typecheck");
    expect(errorsOf(run.output)).toEqual(["src/first-length.ts TS2532", "src/name.ts TS1484"]);
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(2);
  }, 15_000);
});
