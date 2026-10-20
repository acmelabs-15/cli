# The presets in a consumer repo

What this is: probes for the `config-presets` spec. How does a repo run oxlint, oxfmt and tsc on Bun, get their binaries, and build on a shared preset? Run on 2026-10-20 by the Claude Code session that wrote the `config-presets` spec, in throwaway folders in the session scratchpad (not kept), with Exa for the Bun docs.

Setup: macOS on Darwin arm64, Bun 1.4.0 (revision 34cbb9a40), oxlint 1.83.0, oxfmt 0.68.0, ultracite 7.12.0. The usual shell has Node v24.20.0 on PATH through fnm.

## 1. `run.bun` in `bunfig.toml` makes every script run on Bun

A scratch package had one script that prints which `node` it finds and which runtime runs it (the script from note 07).

| Setup | `node` resolves to | Runtime |
|---|---|---|
| no `bunfig.toml` | `~/.local/state/fnm_multishells/.../bin/node` | node v24.20.0 |
| `bunfig.toml` with `[run]` and `bun = true` | `/private/tmp/bun-node-34cbb9a40/node` | bun 1.4.0 |

The Bun docs (https://bun.com/docs/runtime/bunfig, "`run.bun` - auto alias `node` to `bun`"):

- "When `true`, Bun prepends `$PATH` with a `node` symlink that points to the `bun` binary for all scripts or executables invoked by `bun run` or `bun`."
- "This works recursively, so a script that runs another script that runs `node` also runs `bun`. The alias also applies to shebangs that point to `node`."
- "By default, this is enabled if `node` is not already in your `$PATH`."
- "This option is equivalent to prefixing all `bun run` commands with `--bun`."

A Bun maintainer's reply in https://github.com/oven-sh/bun/issues/40967 shows `[run] bun = true` working on Linux x64 with Bun 1.4.1, with Node v26 on PATH. Linux with Bun 1.4.0 is UNVERIFIED here.

What it means: today, on a machine with Node on PATH, this repo's `bun run check` runs tsc, oxlint and oxfmt on that Node. One line in a repo's `bunfig.toml` moves the whole gate onto Bun, local and CI alike. A `bunfig.toml` cannot be imported from a package, so each repo carries the line itself.

## 2. A dependency's own dependencies get no binary in the repo

A scratch package `probe-preset` listed `oxlint` 1.83.0 as a dependency. A scratch repo listed only `probe-preset`, as `file:../preset`.

| Repo | Linker | `node_modules/.bin` |
|---|---|---|
| `bunfig.toml` with `linker = "isolated"` | isolated | absent |
| `bunfig.toml` with `linker = "hoisted"` | hoisted | `oxlint` |
| no `bunfig.toml`, one package, no workspaces | hoisted (Bun's default here) | `oxlint` |

This repo is a workspace, and its install uses the isolated linker (`node_modules/.bun/` holds the store). So whether a preset's own dependency gives the repo an `oxlint` command depends on the linker. A repo that runs `oxlint`, `oxfmt` and `tsc` lists them itself.

## 3. A repo can build on a preset with a nested `extends`

A scratch preset used `extends: [core]` (Ultracite's core), its ignore list, `func-style` off and `typescript/consistent-type-definitions` set to `type`. A scratch repo's `oxlint.config.ts` used `extends: [preset]` and added one folder to the ignore list. Results:

- `export interface Probe` failed with `typescript(consistent-type-definitions)`: the preset's rule applies.
- `export function declared()` passed: the preset's `func-style` off applies.
- `{ b: 1, a: 2 }` failed with `eslint(sort-keys)`: Ultracite's rule applies through two levels.
- The added folder was not linted.

oxlint's docs say that `extends` passes on only `rules`, `plugins` and `overrides` (note 02, section 4). So a repo that extends the preset names `ignorePatterns` again, as brain does today.

## 4. oxfmt formats JSON and Markdown too

- `oxfmt --check packages oxlint.config.ts oxfmt.config.ts` in this repo checks 31 files: 26 TypeScript files under `packages`, the two configs, and the three JSON and Markdown files under `packages` (`package.json`, `README.md`, the editor schema).
- Open question 18 reproduces. `formatRepoConfig` writes a library line of 145 columns for five packages. `oxfmt` with this repo's config rewrites it to 13 lines: the `library` object opens, and the `packages` list puts one path per line. This repo's own `acmelabs.json` passes `oxfmt --check` unchanged.

## 5. The three repos today

brain, jev-gate and this repo carry the same configs, copied by hand:

- **oxlint:** `extends: [core]` from `ultracite/oxlint/core`, the core ignore list, and four rule changes: `func-style` off, `sort-keys` off, `no-await-in-loop` off, `typescript/consistent-type-definitions` set to `type`. The reasons in the comments name each repo's own files. brain adds seven vendored folders to its ignore list.
- **oxfmt:** `ultracite/oxfmt` spread, with `printWidth: 100` and `trailingComma: "all"`. brain adds the same seven folders.
- **tsconfig:** the same `compilerOptions` in all three: `target` and `module` `ESNext`, `moduleResolution` `bundler`, `lib` `["ESNext"]`, `types` `["bun"]`, `strict`, `noUncheckedIndexedAccess`, `noEmit`, `skipLibCheck`, `verbatimModuleSyntax`. Only `include` differs.
- **devDependencies:** `oxlint` 1.83.0, `oxfmt` 0.68.0, `ultracite` 7.12.0, `typescript` `^5.6.0`, `@types/bun` `^1.3.14`.
- brain's reasons live in `docs/decisions/DEC-001-lint-and-format.md` (brain), decided by Peter on 2026-09-19 for every ACMElabs repo.

Ultracite 7.12.0 lists `oxlint` (`^1.79.0`) and `oxfmt` (`>=0.40.0`) as optional peer dependencies, not as dependencies. Its core preset also sets `env: { browser: true }`, which `extends` does not pass on.
