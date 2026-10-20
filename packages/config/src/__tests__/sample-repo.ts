/**
 * The sample-repo seam (spec, "Testing strategy"). It builds @acmelabs/config once per test run,
 * writes a sample repo that uses the built package through thin callers, and runs one of the
 * sample repo's scripts with the real tools and a `node` first on PATH that fails when called.
 */
import { chmod, cp, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPackage } from "../../scripts/build";

/** The folder of @acmelabs/config. */
const packageDir = path.resolve(import.meta.dir, "../..");

/** This repo's root, where the tools that each repo lists itself are installed. */
const repoRoot = path.resolve(packageDir, "../..");

/** The line that the failing `node` prints. A run that calls it has this line in its output. */
export const realNodeLine = "REAL NODE WAS CALLED";

/** A `node` that prints `realNodeLine` and exits 99, so a check that runs on Node fails. */
const failingNode = `#!/bin/sh\necho "${realNodeLine}"\nexit 99\n`;

/** The spec's `bunfig.toml`: every `bun run` script runs on Bun (ADR-0012). */
export const runBunConfig = [
  "[run]",
  "# The gate runs on Bun, also when Node is on PATH (ADR-0012).",
  "bun = true",
  "",
].join("\n");

/** The spec's one-line lint thin caller, for a repo that adds nothing to the preset. */
export const lintThinCaller = [
  "// Lint: the ACMElabs preset. Its deviations and their reasons: the @acmelabs/config README.",
  'export { default } from "@acmelabs/config/oxlint";',
  "",
].join("\n");

/** The spec's lint thin caller for a repo that adds its own ignored folder, `skills`. */
export const lintExtendingCaller = [
  'import preset from "@acmelabs/config/oxlint";',
  'import { defineConfig } from "oxlint";',
  "",
  "export default defineConfig({",
  "  extends: [preset],",
  "  // `extends` does not pass ignorePatterns on, so the preset's list is named again.",
  "  // Vendored skills are never linted or formatted by this repo.",
  '  ignorePatterns: [...preset.ignorePatterns, "skills"],',
  "});",
  "",
].join("\n");

/** The spec's one-line format thin caller, for a repo that adds nothing to the preset. */
export const formatThinCaller = [
  "// Format: the ACMElabs preset. Its deviations and their reasons: the @acmelabs/config README.",
  'export { default } from "@acmelabs/config/oxfmt";',
  "",
].join("\n");

/** The spec's format thin caller for a repo that adds its own ignored folder, `skills`. */
export const formatSpreadCaller = [
  'import preset from "@acmelabs/config/oxfmt";',
  'import { defineConfig } from "oxfmt";',
  "",
  "export default defineConfig({",
  "  ...preset,",
  "  // Vendored skills are never linted or formatted by this repo.",
  '  ignorePatterns: [...preset.ignorePatterns, "skills"],',
  "});",
  "",
].join("\n");

/** The spec's `tsconfig.json` thin caller: the TypeScript preset, and the repo's own include. */
export const typescriptThinCaller = [
  "{",
  '  "extends": "@acmelabs/config/tsconfig.json",',
  '  "include": ["src/**/*.ts"]',
  "}",
  "",
].join("\n");

/**
 * A tsconfig.json that type-checks one file of a sample repo, such as its `oxlint.config.ts`, and
 * no other file. A test uses it to check a thin caller against the built preset's types.
 */
export function configOnlyTsconfig(file: string): string {
  const tsconfig = {
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
    include: [file],
  };
  return `${JSON.stringify(tsconfig, null, 2)}\n`;
}

/** The scripts in a sample repo's package.json, as an ACMElabs repo names them. */
const scripts = {
  lint: "oxlint",
  format: "oxfmt",
  "format:check": "oxfmt --check",
  typecheck: "tsc --noEmit",
};

/** The fields of a package.json that the sample repo's install reads. */
type Manifest = {
  name: string;
  bin?: string | Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** What a sample repo holds besides its package.json and its node_modules. */
export type SampleRepoOptions = {
  /** The files to write, by path from the sample repo's root, such as `src/shape.ts`. */
  files: Record<string, string>;
  /** Whether the sample repo's `bunfig.toml` holds `run.bun` (ADR-0012). The default is true. */
  runBun?: boolean;
};

/** One `bun run` of a script: its exit code, and its stdout followed by its stderr. */
export type ScriptRun = { exitCode: number; output: string };

/** A sample repo in a temp folder, and a way to run one of its scripts there. */
export type SampleRepo = { root: string; run: (script: string) => Promise<ScriptRun> };

async function readManifest(folder: string): Promise<Manifest> {
  return (await Bun.file(path.join(folder, "package.json")).json()) as Manifest;
}

/** Every file under `folder`, by path from `folder`, with its text. */
async function readFiles(folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of new Bun.Glob("**/*").scan({ cwd: folder, dot: true })) {
    files.set(file, await Bun.file(path.join(folder, file)).text());
  }
  return files;
}

/**
 * Builds the package into a temp folder with its package.json and the other files that `files`
 * names, reads every file into memory, and removes the folder. `bun test` has no hook that runs
 * once after every test file, so nothing of the build stays on disk.
 */
async function buildIntoMemory(): Promise<Map<string, string>> {
  const folder = await mkdtemp(path.join(tmpdir(), "acmelabs-config-build-"));
  try {
    await buildPackage(path.join(folder, "dist"));
    const manifest = await readManifest(packageDir);
    for (const entry of ["package.json", ...(manifest.files ?? [])]) {
      if (entry !== "dist") {
        await cp(path.join(packageDir, entry), path.join(folder, entry), { recursive: true });
      }
    }
    return await readFiles(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

let built: Promise<Map<string, string>> | undefined;

/**
 * The built @acmelabs/config: each file it ships, by path from the package folder, with its text.
 * The first call builds it, and every later call in the same test run gets that build.
 */
export function builtPackage(): Promise<Map<string, string>> {
  built ??= buildIntoMemory();
  return built;
}

/** The real folder of the package `name`, found as Node finds it: `node_modules`, from `from` up. */
async function installedFolder(name: string, from: string): Promise<string> {
  let folder = from;
  while (!(await Bun.file(path.join(folder, "node_modules", name, "package.json")).exists())) {
    const parent = path.dirname(folder);
    if (parent === folder) {
      throw new Error(`${name} is not installed: no node_modules/${name} in ${from} or above it`);
    }
    folder = parent;
  }
  return realpath(path.join(folder, "node_modules", name));
}

/** A package's commands, each with its file, from the `bin` field of its package.json. */
function commandsOf(manifest: Manifest): Record<string, string> {
  if (typeof manifest.bin === "string") {
    // A single file is a command named after the package, without its scope.
    return { [path.basename(manifest.name)]: manifest.bin };
  }
  return manifest.bin ?? {};
}

/**
 * Makes a sample repo's node_modules in the hoisted layout, Bun's default for a repo with one
 * package: the built @acmelabs/config, a copy of each of its dependencies, and a link to each of
 * this repo's tools (the package's peer dependencies, which each repo lists itself), with the
 * tools' commands in `.bin`.
 */
async function install(root: string): Promise<void> {
  const modules = path.join(root, "node_modules");
  for (const [file, text] of await builtPackage()) {
    await Bun.write(path.join(modules, "@acmelabs/config", file), text);
  }
  const manifest = await readManifest(packageDir);
  // A copy, as a hoisted install makes it: so a dependency's own imports resolve from the sample
  // repo's node_modules, not from this repo's. Ultracite is a devDependency, bundled into the
  // built presets (ADR-0013), so the sample repo gets no Ultracite.
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const folder = await installedFolder(name, packageDir);
    await cp(folder, path.join(modules, name), { recursive: true });
  }
  await mkdir(path.join(modules, ".bin"), { recursive: true });
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    const folder = await installedFolder(name, repoRoot);
    await mkdir(path.dirname(path.join(modules, name)), { recursive: true });
    await symlink(folder, path.join(modules, name));
    for (const [command, file] of Object.entries(commandsOf(await readManifest(folder)))) {
      await symlink(path.join(folder, file), path.join(modules, ".bin", command));
    }
  }
}

async function runScript(
  root: string,
  script: string,
  env: Record<string, string>,
): Promise<ScriptRun> {
  const child = Bun.spawn([process.execPath, "run", script], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout.text(),
    child.stderr.text(),
    child.exited,
  ]);
  return { exitCode, output: stdout + stderr };
}

/**
 * Writes a sample repo into a new folder under `work`: a package.json with the scripts above, a
 * `bunfig.toml` with `run.bun` unless `runBun` is false, the given files and a node_modules. Its
 * `run` starts `bun run <script>` with the failing `node` first on PATH.
 */
export async function sampleRepo(work: string, options: SampleRepoOptions): Promise<SampleRepo> {
  const folder = await mkdtemp(path.join(work, "sample-"));
  const root = path.join(folder, "repo");
  const manifest = { name: "sample-repo", private: true, type: "module", scripts };
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    ...(options.runBun === false ? {} : { "bunfig.toml": runBunConfig }),
    ...options.files,
  };
  for (const [file, text] of Object.entries(files)) {
    await Bun.write(path.join(root, file), text);
  }
  await install(root);
  const nodeFolder = path.join(folder, "failing-node");
  await Bun.write(path.join(nodeFolder, "node"), failingNode);
  await chmod(path.join(nodeFolder, "node"), 0o755);
  const home = path.join(folder, "home");
  await mkdir(home);
  // PATH and HOME only: an inherited variable such as CLAUDECODE or AI_AGENT changes the
  // tools' output, and a HOME of its own keeps the user's global bunfig.toml out.
  const env = {
    PATH: [nodeFolder, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    HOME: home,
  };
  return { root, run: (script) => runScript(root, script, env) };
}
