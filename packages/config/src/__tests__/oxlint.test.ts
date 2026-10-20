import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { OxlintConfig } from "oxlint";
import core from "ultracite/oxlint/core";

import preset, { lintDeviations } from "../oxlint";
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

/** A config's own rules, each setting under its rule's name. */
function rulesOf(config: OxlintConfig): Record<string, unknown> {
  return { ...config.rules };
}

describe("the lint preset's deviations from Ultracite's core preset", () => {
  test("every rule in which the preset differs from Ultracite's core is in lintDeviations, with a reason", () => {
    const presetRules = rulesOf(preset);
    const coreRules = rulesOf(core);
    const reasons = new Map(
      Object.entries(lintDeviations).map(([rule, deviation]) => [rule, deviation.reason.trim()]),
    );
    const differingWithoutReason = Object.keys(presetRules).filter(
      (rule) => !Bun.deepEquals(presetRules[rule], coreRules[rule]) && !reasons.get(rule),
    );
    expect(differingWithoutReason).toEqual([]);
  });

  test("every deviation is the preset's setting for its rule, and differs from Ultracite's core", () => {
    const presetRules = rulesOf(preset);
    const coreRules = rulesOf(core);
    for (const [rule, deviation] of Object.entries(lintDeviations)) {
      expect({ rule, setting: presetRules[rule] }).toEqual({ rule, setting: deviation.setting });
      expect({ rule, setting: deviation.setting }).not.toEqual({ rule, setting: coreRules[rule] });
    }
  });
});

describe("the built lint preset", () => {
  test("dist/oxlint.js bundles Ultracite's core preset and imports only oxlint, which the repo lists", async () => {
    const files = await builtPackage();
    const imports = new Bun.Transpiler({ loader: "js" }).scanImports(
      files.get("dist/oxlint.js") ?? "",
    );
    // The bundle keeps one import per bundled module, so oxlint can be imported more than once.
    expect([...new Set(imports.map((imported) => imported.path))]).toEqual(["oxlint"]);
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

  test("a function declaration above its caller, unsorted object keys and await in a loop pass", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxlint.config.ts": lintThinCaller,
        "src/order.ts": [
          "function double(value: number): number {",
          "  return value * 2;",
          "}",
          "",
          "export function quadruple(value: number): number {",
          "  return double(double(value));",
          "}",
          "",
        ].join("\n"),
        "src/keys.ts":
          'export const manifest = { name: "sample", version: "1.0.0", description: "" };\n',
        "src/steps.ts": [
          "export async function runInOrder(steps: (() => Promise<void>)[]): Promise<void> {",
          "  for (const step of steps) {",
          "    await step();",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
    });
    const run = await repo.run("lint");
    expect(run.output).toContain("Found 0 warnings and 0 errors.");
    // The three files and oxlint.config.ts: each file is linted, and no rule fires on it.
    expect(run.output).toContain(" on 4 files ");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(0);
  });

  test("== fails with eqeqeq, so Ultracite's rules still apply, and the same line under dist/ is not linted", async () => {
    const looseEquality =
      "export function same(left: number, right: number): boolean {\n  return left == right;\n}\n";
    const repo = await sampleRepo(work, {
      files: {
        "oxlint.config.ts": lintThinCaller,
        "src/compare.ts": looseEquality,
        "dist/compare.ts": looseEquality,
      },
    });
    const run = await repo.run("lint");
    expect(run.output).toContain("eslint(eqeqeq)");
    expect(run.output).toContain("[src/compare.ts:2:15]");
    expect(run.output).not.toContain("dist/");
    expect(run.output).toContain("Found 0 warnings and 1 error.");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(1);
  });
});

describe("bun run lint in a sample repo with the extends thin caller and one more ignored folder", () => {
  test("the preset's rules apply, and neither the preset's ignored folders nor skills/ are linted", async () => {
    // An interface fails with the preset's deviation; == fails with Ultracite's core rule.
    const twoErrors = [
      "export interface Shape {",
      "  name: string;",
      "}",
      "",
      "export function same(left: Shape, right: Shape): boolean {",
      "  return left.name == right.name;",
      "}",
      "",
    ].join("\n");
    const repo = await sampleRepo(work, {
      files: {
        "oxlint.config.ts": lintExtendingCaller,
        "src/shape.ts": twoErrors,
        "skills/shape.ts": twoErrors,
        "dist/shape.ts": twoErrors,
      },
    });
    const run = await repo.run("lint");
    expect(run.output).toContain("typescript(consistent-type-definitions)");
    expect(run.output).toContain("eslint(eqeqeq)");
    expect(run.output).not.toContain("skills/");
    expect(run.output).not.toContain("dist/");
    expect(run.output).toContain("Found 0 warnings and 2 errors.");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(1);
  });
});

describe("bun run lint in a sample repo with no Ultracite in its node_modules", () => {
  test("Ultracite is absent, and the bundled preset still applies Ultracite's core rules and the deviations", async () => {
    // An interface fails with the preset's deviation; == fails with Ultracite's core rule.
    const twoErrors = [
      "export interface Shape {",
      "  name: string;",
      "}",
      "",
      "export function same(left: Shape, right: Shape): boolean {",
      "  return left.name == right.name;",
      "}",
      "",
    ].join("\n");
    const repo = await sampleRepo(work, {
      files: { "oxlint.config.ts": lintThinCaller, "src/shape.ts": twoErrors },
    });
    const ultraciteManifest = Bun.file(path.join(repo.root, "node_modules/ultracite/package.json"));
    expect(await ultraciteManifest.exists()).toBe(false);
    const run = await repo.run("lint");
    expect(run.output).toContain("typescript(consistent-type-definitions)");
    expect(run.output).toContain("eslint(eqeqeq)");
    expect(run.output).toContain("Found 0 warnings and 2 errors.");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(1);
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
