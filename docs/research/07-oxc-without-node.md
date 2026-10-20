# oxlint and oxfmt with no Node on PATH

What this is: a probe of open question 4 in `spec/README.md`. Do oxlint and oxfmt load a TypeScript config under Bun with no Node on PATH? Run on 2026-10-20. Produced by a build sub-agent of the repo-model build (task 2), in acmelabs-15/cli on branch `repo-model`, with Exa for the Bun docs. The configs under test are this repo's `oxlint.config.ts` and `oxfmt.config.ts`.

Setup: macOS 26.6.2 on Darwin arm64, Bun 1.4.0 (revision 34cbb9a40), oxlint 1.83.0, oxfmt 0.68.0, ultracite 7.12.0. The usual shell has Node v24.20.0 on PATH through fnm.

## Answer

Yes, on this machine. With no Node on PATH, `bun run lint` and `bun run format:check` pass, and both tools load their TypeScript config. `bun --bun run` gives the same results. The whole gate, `bun run check`, passes with no Node too. Linux, the CI platform, is UNVERIFIED.

## 1. How the two tools start

- `node_modules/.bin/oxlint` and `node_modules/.bin/oxfmt` are JavaScript files with the shebang `#!/usr/bin/env node`.
- Both load a TypeScript config with a JavaScript `import()` of the file (`importJsConfig` in `oxlint/dist/js_config.js` and `oxfmt/dist/cli.js`). On Node, that needs Node's type stripping. The error hint in both files names `Node.js ^20.19.0 || >=22.18.0`. Bun imports a `.ts` file natively.
- So the runtime that `node` resolves to decides the result.

## 2. Which runtime runs a `bun run` script

A scratch package (not kept) had one script:

```
echo "node at: $(command -v node)"; node -e 'console.log("runtime:", typeof Bun === "undefined" ? "node " + process.version : "bun " + Bun.version)'
```

| Command | PATH | `node` resolves to | Runtime |
|---|---|---|---|
| `bun run` | the usual shell (fnm Node on PATH) | `~/.local/state/fnm_multishells/.../bin/node` | node v24.20.0 |
| `bun run` | `$HOME/.bun/bin:/usr/bin:/bin` | `/private/tmp/bun-node-34cbb9a40/node` | bun 1.4.0 |
| `bun --bun run` | `$HOME/.bun/bin:/usr/bin:/bin` | `/private/tmp/bun-node-34cbb9a40/node` | bun 1.4.0 |
| `bun --bun run` | the usual shell (fnm Node on PATH) | `/private/tmp/bun-node-34cbb9a40/node` | bun 1.4.0 |

The docs agree:

- `bun run` respects a `#!/usr/bin/env node` shebang and runs the file with `node`. `--bun` forces Bun's runtime "via symlinking node". https://bun.com/docs/runtime
- Bun links `node` to `bun` when `node` is not available (Bun v1.0.18, 2023-12-14). https://bun.com/blog/bun-v1.0.18
- The link is a `node` symlink in a temp folder that Bun puts first on PATH. A maintainer reply in https://github.com/oven-sh/bun/issues/40967 says so. That issue reports `--bun` ignored in one environment; the reply could not reproduce it on Linux x64 with Bun 1.4.0, and this probe did not see it on macOS with fnm.

This confirms the caveat in note 02: with Node on PATH, `bun run` runs the tools on that Node (https://github.com/oxc-project/oxc/issues/20695).

## 3. Runs with no Node on PATH

Every run below starts from this environment. First, the check that `node` is absent:

```
$ env -i HOME="$HOME" PATH="$HOME/.bun/bin:/usr/bin:/bin" /bin/sh -c 'command -v node; echo "command -v node exit: $?"'
command -v node exit: 1
```

### The configs load

A pass alone does not prove that a config loaded, so two probe files went in first and came out after:

- `export interface Probe { a: number; }` fails only under this repo's rule `typescript/consistent-type-definitions: ["error", "type"]`.
- Two imports in reverse order fail only under Ultracite's `sortImports`. With no config file, oxfmt prints `No config found, using defaults.` and passes the same file.

`env -i HOME="$HOME" PATH="$HOME/.bun/bin:/usr/bin:/bin" bun run lint`, exit 1:

```
  x typescript(consistent-type-definitions): Use `type` instead of `interface`.
   ,-[packages/cli/src/fmt-probe/lint.ts:2:8]
...
Found 0 warnings and 1 error.
Finished in 41ms on 8 files with 416 rules using 10 threads.
error: script "lint" exited with code 1
```

`env -i HOME="$HOME" PATH="$HOME/.bun/bin:/usr/bin:/bin" bun run format:check`, exit 1:

```
packages/cli/src/fmt-probe/index.ts (2ms)

Format issues found in above 1 files. Run without `--check` to fix.
Finished in 148ms on 10 files using 10 threads.
error: script "format:check" exited with code 1
```

`bun --bun run lint` and `bun --bun run format:check` gave the same diagnostics and exit 1. The 416 rules come from Ultracite's core preset. In a folder with no config file, oxlint runs 96 rules (`Finished in 24ms on 1 file with 96 rules using 10 threads.`).

### A direct call of the bin fails

The `node` link exists only inside `bun run` and `bun --bun`. A direct call of the bin, as a plain shell or an editor would make it, fails with no Node on PATH. Run from a scratch folder that holds `a.ts` and no config, with `<repo>` for this repo's path:

```
$ env -i HOME="$HOME" PATH="$HOME/.bun/bin:/usr/bin:/bin" <repo>/node_modules/.bin/oxlint a.ts
env: node: No such file or directory
```

That call exits 127. `bun --bun <repo>/node_modules/.bin/oxlint a.ts` in the same environment runs and exits 0.

### Clean runs

With the probe files removed:

| Command (each under `env -i HOME="$HOME" PATH="$HOME/.bun/bin:/usr/bin:/bin"`) | Exit | Last lines |
|---|---|---|
| `bun run lint` | 0 | `Found 0 warnings and 0 errors.` `Finished in 8ms on 4 files with 416 rules using 10 threads.` |
| `bun run format:check` | 0 | `All matched files use the correct format.` `Finished in 92ms on 6 files using 10 threads.` |
| `bun --bun run lint` | 0 | `Found 0 warnings and 0 errors.` `Finished in 9ms on 4 files with 416 rules using 10 threads.` |
| `bun --bun run format:check` | 0 | `All matched files use the correct format.` `Finished in 64ms on 6 files using 10 threads.` |
| `bun run check` | 0 | `2 pass` `0 fail` `Ran 2 tests across 1 file.` |

`bun run check` runs typecheck, lint, format check and tests. `tsc` has the same `node` shebang, so the TypeScript check also ran on Bun.

## 4. A side note on oxlint's output

oxlint prints a compact one-line format and no summary line when `CLAUDECODE=1` is set, as it is in a Claude Code shell. The runtime does not change the format: Node-free with `CLAUDECODE=1` gives the compact format, and real Node with an empty environment gives the summary. The exit codes are the same either way.

## What it means for open question 4

- On macOS arm64, oxlint 1.83.0 and oxfmt 0.68.0 load `oxlint.config.ts` and `oxfmt.config.ts` under Bun 1.4.0 with no Node installed.
- `bun run` picks a real Node whenever one is on PATH. A CI runner image that ships Node would lint under that Node, not Bun. Whether the GitHub-hosted images put Node on PATH is UNVERIFIED here.
- `bun --bun run` forces Bun whether Node is on PATH or not. It is one way for the shared workflows or the presets to keep the gate on Bun. That choice belongs to `config-presets` and `shared-workflows`.
- A tool that calls the bin directly, outside `bun run`, needs a `node` on PATH. Editor extensions are such tools; their setup is not tested here.
- Still UNVERIFIED: Linux x64, and the newer oxlint 1.89.0 and oxfmt 0.74.0.
