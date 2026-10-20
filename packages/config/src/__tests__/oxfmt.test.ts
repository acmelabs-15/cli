import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { OxfmtConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

import preset, { formatDeviations } from "../oxfmt";
import {
  builtPackage,
  configOnlyTsconfig,
  formatSpreadCaller,
  formatThinCaller,
  lintExtendingCaller,
  lintThinCaller,
  realNodeLine,
  sampleRepo,
  typescriptThinCaller,
} from "./sample-repo";

let work: string;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "acmelabs-config-oxfmt-"));
  // The first call builds the package, which can take longer than the default 5 s.
  await builtPackage();
}, 30_000);

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/** A config's options, each value under its option's name. */
function optionsOf(config: OxfmtConfig): Record<string, unknown> {
  return { ...config };
}

/** Two imports in the order that Ultracite's `sortImports` rejects: `./b` before `./a`. */
const importsInWrongOrder = [
  'import { b } from "./b";',
  'import { a } from "./a";',
  "",
  "export const both = [a, b];",
  "",
].join("\n");

describe("the format preset's deviations from Ultracite's oxfmt preset", () => {
  test("every option in which the preset differs from Ultracite's is in formatDeviations, with a reason", () => {
    const presetOptions = optionsOf(preset);
    const ultraciteOptions = optionsOf(ultracite);
    const reasons = new Map(
      Object.entries(formatDeviations).map(([option, deviation]) => [
        option,
        deviation.reason.trim(),
      ]),
    );
    // Both sides' names: an option that the preset drops differs from Ultracite's too.
    const options = new Set([...Object.keys(presetOptions), ...Object.keys(ultraciteOptions)]);
    const differingWithoutReason = [...options].filter(
      (option) =>
        !Bun.deepEquals(presetOptions[option], ultraciteOptions[option]) && !reasons.get(option),
    );
    expect(differingWithoutReason).toEqual([]);
  });

  test("every deviation is the preset's setting for its option, and differs from Ultracite's", () => {
    const presetOptions = optionsOf(preset);
    const ultraciteOptions = optionsOf(ultracite);
    for (const [option, deviation] of Object.entries(formatDeviations)) {
      expect({ option, setting: presetOptions[option] }).toEqual({
        option,
        setting: deviation.setting,
      });
      expect({ option, setting: deviation.setting }).not.toEqual({
        option,
        setting: ultraciteOptions[option],
      });
    }
  });
});

describe("the built format preset", () => {
  test("dist/oxfmt.js bundles Ultracite's oxfmt preset and imports only oxfmt, which the repo lists", async () => {
    const files = await builtPackage();
    const imports = new Bun.Transpiler({ loader: "js" }).scanImports(
      files.get("dist/oxfmt.js") ?? "",
    );
    // The bundle keeps one import per bundled module, so oxfmt can be imported more than once.
    expect([...new Set(imports.map((imported) => imported.path))]).toEqual(["oxfmt"]);
  });

  test("dist/oxfmt.d.ts types ignorePatterns as present: the spread thin caller needs no fallback", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxfmt.config.ts": formatSpreadCaller,
        "tsconfig.json": configOnlyTsconfig("oxfmt.config.ts"),
      },
    });
    expect(await repo.run("typecheck")).toEqual({
      exitCode: 0,
      output: expect.not.stringContaining(realNodeLine),
    });
  }, 15_000);
});

describe("bun run format:check in a sample repo with the one-line thin caller", () => {
  test("a 95-column line stays unchanged, and a multi-line call and signature keep trailing commas", async () => {
    // 95 columns: at Ultracite's 80, the call would wrap.
    const longLine =
      "export const totals = sum(firstValue, secondValue, thirdValue, fourthValue, fifthValue, sixth);\n";
    expect(longLine.length - 1).toBe(95);
    // Too long for one line at 100 columns. With Ultracite's "es5", the commas after the last
    // parameter and the last argument would go.
    const trailingCommas = [
      "export function describeShape(",
      "  name: string,",
      "  width: number,",
      "  height: number,",
      "  depth: number,",
      "  color: string,",
      "  material: string,",
      "): string {",
      '  return [name, width, height, depth, color, material].join(" ");',
      "}",
      "",
      "export const shape = describeShape(",
      '  "a box for the long shelf in the hall",',
      "  120,",
      "  40,",
      "  35,",
      '  "a warm grey",',
      '  "oak",',
      ");",
      "",
    ].join("\n");
    const repo = await sampleRepo(work, {
      files: {
        "oxfmt.config.ts": formatThinCaller,
        "src/total.ts": longLine,
        "src/shape.ts": trailingCommas,
      },
    });
    const run = await repo.run("format:check");
    expect(run.output).not.toContain("src/");
    // package.json, bunfig.toml, oxfmt.config.ts and the two files: each one is checked.
    expect(run.output).toContain(" on 5 files ");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(0);
  });

  test("imports in the wrong order fail, so Ultracite's options still apply, and the same file under dist/ is not checked", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxfmt.config.ts": formatThinCaller,
        "src/imports.ts": importsInWrongOrder,
        "dist/imports.ts": importsInWrongOrder,
      },
    });
    const run = await repo.run("format:check");
    expect(run.output).toContain("src/imports.ts");
    expect(run.output).not.toContain("dist/");
    expect(run.output).toContain("Format issues found in above 1 files.");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(1);
  });
});

describe("bun run format:check in a sample repo with the spread thin caller and one more ignored folder", () => {
  test("the preset's options apply, and neither the preset's ignored folders nor skills/ are checked", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxfmt.config.ts": formatSpreadCaller,
        "src/imports.ts": importsInWrongOrder,
        "skills/imports.ts": importsInWrongOrder,
        "dist/imports.ts": importsInWrongOrder,
      },
    });
    const run = await repo.run("format:check");
    expect(run.output).toContain("src/imports.ts");
    expect(run.output).not.toContain("skills/");
    expect(run.output).not.toContain("dist/");
    expect(run.output).toContain("Format issues found in above 1 files.");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(1);
  });
});

describe("bun run format:check in a sample repo with no Ultracite in its node_modules", () => {
  test("Ultracite is absent, and the bundled preset still applies Ultracite's options and the deviations", async () => {
    // 95 columns: it passes at the preset's 100 and would wrap at Ultracite's 80.
    const longLine =
      "export const totals = sum(firstValue, secondValue, thirdValue, fourthValue, fifthValue, sixth);\n";
    const repo = await sampleRepo(work, {
      files: {
        "oxfmt.config.ts": formatThinCaller,
        "src/total.ts": longLine,
        "src/imports.ts": importsInWrongOrder,
      },
    });
    const ultraciteManifest = Bun.file(path.join(repo.root, "node_modules/ultracite/package.json"));
    expect(await ultraciteManifest.exists()).toBe(false);
    const run = await repo.run("format:check");
    // Ultracite's sortImports rejects the imports; the preset's printWidth keeps the long line.
    expect(run.output).toContain("src/imports.ts");
    expect(run.output).not.toContain("src/total.ts");
    expect(run.output).toContain("Format issues found in above 1 files.");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(1);
  });
});

describe("the spec's thin callers, which scaffold writes word for word", () => {
  test("the two lint, the two format and the tsconfig.json thin callers pass bun run format:check as written", async () => {
    const repo = await sampleRepo(work, {
      files: {
        "oxlint.config.ts": lintThinCaller,
        "oxfmt.config.ts": formatThinCaller,
        // Not named *.config.ts: oxfmt would read a nested oxfmt.config.ts as a config.
        "callers/lint-extends.ts": lintExtendingCaller,
        "callers/format-spread.ts": formatSpreadCaller,
        // Its own name, so oxfmt formats it as a repo's tsconfig.json; in a folder, so it is not
        // the sample repo's own.
        "callers/tsconfig.json": typescriptThinCaller,
      },
    });
    const run = await repo.run("format:check");
    expect(run.output).not.toContain(".ts");
    expect(run.output).not.toContain("tsconfig.json");
    // package.json, bunfig.toml and the five thin callers: each one is checked.
    expect(run.output).toContain(" on 7 files ");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(0);
  });
});
