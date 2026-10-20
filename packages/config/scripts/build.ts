/**
 * Build @acmelabs/config into JavaScript and type files (ADR-0005).
 *
 *   bun run build    write packages/config/dist
 */
import { rm } from "node:fs/promises";
import path from "node:path";

/** The folder of @acmelabs/config. */
const packageDir = path.resolve(import.meta.dir, "..");

/** The preset files. Each one becomes `<name>.js` and `<name>.d.ts` in the output folder. */
const presets = [path.join(packageDir, "src/oxlint.ts"), path.join(packageDir, "src/oxfmt.ts")];

/**
 * The comment at the top of each built JavaScript file. The file bundles Ultracite's code, so it
 * names Ultracite's license and the file beside it that holds Ultracite's notice (ADR-0013).
 */
const banner = [
  "// This file bundles code from Ultracite (https://github.com/haydenbleasel/ultracite), which is",
  "// under the MIT license. Ultracite's copyright and permission notice: ../THIRD-PARTY-NOTICES.md",
].join("\n");

/**
 * The tsc flags for the type files. tsc gets the preset files by name, so it reads no
 * tsconfig.json, and these flags set every option: the TypeScript preset has `noEmit`, and a build
 * must emit.
 */
const declarationFlags = [
  "--declaration",
  "--emitDeclarationOnly",
  "--rootDir",
  path.join(packageDir, "src"),
  "--target",
  "ESNext",
  "--module",
  "ESNext",
  "--moduleResolution",
  "bundler",
  "--strict",
  "--skipLibCheck",
  "--verbatimModuleSyntax",
];

/** Writes the type files with tsc, which runs on Bun; throws with tsc's output when it fails. */
async function writeDeclarations(outDir: string): Promise<void> {
  const tsc = Bun.resolveSync("typescript/bin/tsc", packageDir);
  const child = Bun.spawn(
    [process.execPath, tsc, ...declarationFlags, "--outDir", outDir, ...presets],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout.text(),
    child.stderr.text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`tsc failed with exit code ${exitCode}:\n${stdout}${stderr}`);
  }
}

/**
 * Builds the presets into `outDir`, which it empties first: JavaScript with `bun build`, and type
 * files with tsc. The JavaScript bundles Ultracite's two presets, so a repo installs no Ultracite
 * (ADR-0013); `oxlint` and `oxfmt` stay imports, so a repo loads the tools it lists itself.
 */
export async function buildPackage(outDir: string): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await Bun.build({
    entrypoints: presets,
    outdir: outDir,
    root: path.join(packageDir, "src"),
    // The presets load under Node too, such as in an editor's oxlint extension (ADR-0005).
    target: "node",
    format: "esm",
    external: ["oxlint", "oxfmt"],
    banner,
  });
  await writeDeclarations(outDir);
}

if (import.meta.main) {
  const outDir = path.join(packageDir, "dist");
  await buildPackage(outDir);
  console.log(`${outDir}: built`);
}
