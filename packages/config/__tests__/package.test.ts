import { describe, expect, test } from "bun:test";
import path from "node:path";

/** The package's own package.json, which names the tools as peer dependencies. */
const packageManifestPath = path.join(import.meta.dir, "../package.json");

/** This repo's root package.json, which lists the tools that the sample-repo tests link. */
const rootManifestPath = path.join(import.meta.dir, "../../../package.json");

/** The tools that each repo lists itself, at the preset's versions (spec, "Boundaries"). */
const tools = ["oxlint", "oxfmt", "typescript", "@types/bun"];

/** The fields of a package.json that this test reads. */
type Manifest = {
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function readManifest(manifestPath: string): Promise<Manifest> {
  return (await Bun.file(manifestPath).json()) as Manifest;
}

describe("the tool versions in @acmelabs/config and in this repo's root", () => {
  test("the root lists each tool at the version that the peerDependencies name", async () => {
    const { peerDependencies } = await readManifest(packageManifestPath);
    const { devDependencies = {} } = await readManifest(rootManifestPath);
    // The sample-repo tests link the root's installed tools. A root version that differs from the
    // peer would test the presets against a tool version that they do not name.
    const rootVersions = Object.fromEntries(tools.map((tool) => [tool, devDependencies[tool]]));
    expect(rootVersions).toEqual(peerDependencies ?? {});
  });
});
