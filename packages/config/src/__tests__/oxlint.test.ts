import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  builtPackage,
  lintExtendingCaller,
  lintThinCaller,
  realNodeLine,
  sampleRepo,
} from "./sample-repo";

let work: string;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "acmelabs-config-oxlint-"));
  // The first call builds the package, which can take longer than the default 5 s.
  await builtPackage();
}, 30_000);

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/** A tsconfig.json that type-checks only the sample repo's oxlint.config.ts. */
const configOnlyTsconfig = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ESNext"],
      types: [],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["oxlint.config.ts"],
  },
  null,
  2,
)}\n`;

describe("the built lint preset", () => {
  test("dist/oxlint.js keeps Ultracite's core preset as an import, which the repo resolves", async () => {
    const files = await builtPackage();
    expect(files.get("dist/oxlint.js")).toContain('from "ultracite/oxlint/core"');
  });

  test("dist/oxlint.d.ts types ignorePatterns as present: a thin caller extends it, no fallback", async () => {
    const repo = await sampleRepo(work, {
      files: { "oxlint.config.ts": lintExtendingCaller, "tsconfig.json": configOnlyTsconfig },
    });
    expect(await repo.run("typecheck")).toEqual({
      exitCode: 0,
      output: expect.not.stringContaining(realNodeLine),
    });
  }, 15_000);
});

describe("bun run lint in a sample repo with the one-line thin caller", () => {
  test("an interface fails with typescript/consistent-type-definitions", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxlint.config.ts": lintThinCaller,
        "src/shape.ts": "export interface Shape {\n  name: string;\n}\n",
      },
    });
    const run = await repo.run("lint");
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("typescript(consistent-type-definitions)");
    expect(run.output).toContain("Found 0 warnings and 1 error.");
    expect(run.output).not.toContain(realNodeLine);
  });

  test("the same shape as a type passes", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxlint.config.ts": lintThinCaller,
        "src/shape.ts": "export type Shape = {\n  name: string;\n};\n",
      },
    });
    expect(await repo.run("lint")).toEqual({
      exitCode: 0,
      output: expect.not.stringContaining(realNodeLine),
    });
  });
});

describe("the sample repo's Node check", () => {
  test("without run.bun, bun run lint starts oxlint on the failing node, and the run fails", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxlint.config.ts": lintThinCaller,
        "src/shape.ts": "export type Shape = {\n  name: string;\n};\n",
      },
      runBun: false,
    });
    const run = await repo.run("lint");
    expect(run.exitCode).toBe(99);
    expect(run.output).toContain(realNodeLine);
  });
});
