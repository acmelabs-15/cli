# Spec: config-presets

Module `config-presets`, layer 1 of the capability map (`spec/README.md`). It depends on no other module. At Peter's choice it also changes one function of `repo-model`, `formatRepoConfig` (open question 18). Words follow `CONTEXT.md`. Status: approved by Peter on 2026-10-20.

## Objective

Today brain, jev-gate and this repo carry the same lint, format and TypeScript configs, copied by hand. Each copy explains its deviations from Ultracite in comments that name that repo's own files (`docs/research/08-presets-in-a-consumer-repo.md`, section 5). This module makes `@acmelabs/config`: three presets that a repo imports through thin callers, each deviation kept with its reason inside the package. It also moves the gate onto Bun (ADR-0012), moves this repo onto the presets, and makes `acmelabs.json` keep the layout that the format check gives it.

The users are the maintainers of ACMElabs repos, and the modules that put the presets into repos: `scaffold` (writes the thin callers into a new repo), `jev-gate-migration` (replaces jev-gate's copies), `cli-release` (publishes the package) and `upgrade` (bumps its pin).

Acceptance: see "Success criteria".

## Settled before this spec

| Decision | Source |
|---|---|
| The presets ship as their own package, `@acmelabs/config`, from this repo's workspace | ADR-0004 |
| The package publishes JavaScript built with `bun build`, with `.d.ts` files built with `tsc` | ADR-0005 |
| The presets start from Ultracite's and carry brain's deviations with their reasons | the brief; brain's `docs/decisions/DEC-001-lint-and-format.md` |
| Every repo has `[run]` with `bun = true` in its `bunfig.toml`, so the gate runs on Bun; a test proves that no check calls Node | ADR-0012; Peter, 2026-10-20 (open question 4) |
| The tests use a new seam: a sample repo with real tools (below) | Peter, 2026-10-20 |
| `formatRepoConfig` writes the layout that oxfmt gives; every file `acmelabs` writes passes the format check unchanged | Peter, 2026-10-20 (open question 18) |

## Tech stack

- Bun 1.4.0, TypeScript, `bun:test`.
- oxlint 1.83.0, oxfmt 0.68.0, ultracite 7.12.0, typescript `^5.6.0`, `@types/bun` `^1.3.14`: the versions the three repos use today. **Agent's call, small and reversible:** no version moves in this module, so jev-gate's migration changes no lint or format result. oxlint 1.89.0 and oxfmt 0.74.0 exist (2026-10-19); a bump is a later change with its own changeset.

## The package

```json
{
  "name": "@acmelabs/config",
  "version": "0.0.0",
  "private": true,
  "description": "The ACMElabs presets: oxlint, oxfmt and TypeScript, each deviation with its reason.",
  "license": "MIT",
  "type": "module",
  "exports": {
    "./oxlint": { "types": "./dist/oxlint.d.ts", "default": "./dist/oxlint.js" },
    "./oxfmt": { "types": "./dist/oxfmt.d.ts", "default": "./dist/oxfmt.js" },
    "./tsconfig.json": "./tsconfig.json"
  },
  "files": ["dist", "tsconfig.json"],
  "devDependencies": { "ultracite": "7.12.0" },
  "peerDependencies": {
    "oxlint": "1.83.0",
    "oxfmt": "0.68.0",
    "typescript": "^5.6.0",
    "@types/bun": "^1.3.14"
  }
}
```

- **Ultracite is bundled into the package** (ADR-0013, Peter, 2026-10-20, review finding 3). The build puts Ultracite's two presets into the built JavaScript, Ultracite is a devDependency, and the package ships Ultracite's MIT notice. A repo installs no Ultracite and stops listing it.
- **The four tools are peer dependencies, and each repo lists them itself.** **Agent's call, from evidence:** with Bun's isolated linker, which Bun uses for a workspace, a dependency's own dependencies give the repo no `oxlint` or `oxfmt` command (note 08, section 2). oxlint and oxfmt are exact, because the deviations name the rules and options of those versions.
- **Private at 0.0.0 until `cli-release`,** as `@acmelabs/cli` is. A changeset records the new package.
- **A `README.md`** (the rule for every package): what the package is, how to install it, the thin callers below, and the table of deviations with their reasons.
- `dist/` is build output and stays out of git.

## The presets

### Lint: `@acmelabs/config/oxlint`

Ultracite's core preset through `extends`, Ultracite's ignore list named again (`extends` does not pass `ignorePatterns` on), and four deviations:

| Rule | Ultracite | The preset | Reason |
|---|---|---|---|
| `func-style` | `expression` | `off` | Function declarations, with helpers above their callers: Ultracite's `no-use-before-define` requires that order. |
| `sort-keys` | `error` | `off` | Object keys follow meaning, not the alphabet: a manifest's fields, a record's fields, a fixture tree's paths. |
| `no-await-in-loop` | `error` | `off` | Steps that must run in order stay sequential: ordered writes, a check that finishes before the first write, one outside program at a time so outputs do not mix. `Promise.all` would reorder them. |
| `typescript/consistent-type-definitions` | `interface` | `type` | ACMElabs code uses `type` for object shapes, as the specs' code style shows. |

Ultracite's core preset also sets `env: { browser: true }`, which `extends` does not pass on. The preset sets no `env`, as today's configs do, so a repo that moves onto it gets the same results as today.

### Format: `@acmelabs/config/oxfmt`

Ultracite's oxfmt preset, spread (oxfmt has no `extends`), with two deviations:

| Option | Ultracite | The preset | Reason |
|---|---|---|---|
| `printWidth` | 80 | 100 | Plain TypeScript with long paths and messages: at 80 columns, every template literal wraps. |
| `trailingComma` | `"es5"` | `"all"` | One convention across ACMElabs repos. |

### TypeScript: `@acmelabs/config/tsconfig.json`

The `compilerOptions` that the three repos share today. No upstream preset exists here, so every option is a choice, and each one has a comment with its reason in the file:

| Option | Value | Reason |
|---|---|---|
| `target` | `ESNext` | Bun runs the newest syntax; nothing is compiled down. |
| `module`, `moduleResolution` | `ESNext`, `bundler` | Resolve imports as Bun does: package exports, and no file extensions. |
| `lib` | `["ESNext"]` | No DOM: the code runs on Bun, not in a browser. |
| `types` | `["bun"]` | Bun's globals and APIs. The repo installs `@types/bun`. |
| `strict` | `true` | Every strict check. |
| `noUncheckedIndexedAccess` | `true` | An index read can be `undefined`, and the type says so. |
| `noEmit` | `true` | `tsc` only checks; Bun runs the source. A library build sets its own output. |
| `skipLibCheck` | `true` | Dependencies' type files are not checked: faster, and not this repo's to fix. |
| `verbatimModuleSyntax` | `true` | A type-only import says `type`, so a transpiler drops it without type information. |

The preset sets no `include`: a path in an extended config resolves from the preset's own folder, so each repo names its own.

### Deviations as data

**Agent's call, small and reversible:** each deviation is data with its reason, and the preset object is built from that data. So a test checks that every difference from Ultracite has a reason, and that the README lists each one.

```ts
/** A setting in which a preset differs from Ultracite's, kept with its reason. */
export type Deviation<Setting> = { setting: Setting; reason: string };
```

## Thin callers

The files a repo keeps. `scaffold` writes them into a new repo, and `jev-gate-migration` writes them into jev-gate.

`oxlint.config.ts` and `oxfmt.config.ts`, when the repo adds nothing:

```ts
// Lint: the ACMElabs preset. Its deviations and their reasons: the @acmelabs/config README.
export { default } from "@acmelabs/config/oxlint";
```

```ts
// Format: the ACMElabs preset. Its deviations and their reasons: the @acmelabs/config README.
export { default } from "@acmelabs/config/oxfmt";
```

When the repo adds its own settings, such as brain's vendored folders. Each addition carries its reason, as the preset's do:

```ts
import preset from "@acmelabs/config/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [preset],
  // `extends` does not pass ignorePatterns on, so the preset's list is named again.
  // Vendored skills are never linted or formatted by this repo.
  ignorePatterns: [...preset.ignorePatterns, "skills"],
});
```

```ts
import preset from "@acmelabs/config/oxfmt";
import { defineConfig } from "oxfmt";

export default defineConfig({
  ...preset,
  // Vendored skills are never linted or formatted by this repo.
  ignorePatterns: [...preset.ignorePatterns, "skills"],
});
```

The preset types say that `ignorePatterns` is always present, so a thin caller needs no fallback. The imports stand in the order that the format preset sorts them, so each thin caller passes the format check as written.

`tsconfig.json`:

```json
{
  "extends": "@acmelabs/config/tsconfig.json",
  "include": ["src/**/*.ts"]
}
```

Bun's runtime ignores an `extends` that names a package (note 02, section 5); `tsc` follows it. The preset sets none of the options that Bun's runtime reads for code (`paths`, `jsx`, decorators), so nothing is lost. Whether Bun's runtime reads `verbatimModuleSyntax` is UNVERIFIED; `tsc` makes the code mark type-only imports either way.

`bunfig.toml` (ADR-0012):

```toml
[run]
# The gate runs on Bun, also when Node is on PATH (ADR-0012).
bun = true
```

`package.json` devDependencies, with the scripts unchanged:

```json
"@acmelabs/config": "<exact version>",
"oxlint": "1.83.0",
"oxfmt": "0.68.0",
"typescript": "^5.6.0",
"@types/bun": "^1.3.14"
```

## This repo on the presets

- The root `oxlint.config.ts` and `oxfmt.config.ts` import the presets' source by relative path (`./packages/config/src/oxlint.ts`), and `tsconfig.json` extends `./packages/config/tsconfig.json`. **Agent's call, small and reversible:** Bun runs the source with no build, so the gate needs no build step. This repo's `$schema` line already points at its own source the same way. The sample-repo tests prove the import by package name, from the built package.
- The root drops `ultracite` from its devDependencies.
- A root `bunfig.toml` holds `run.bun` (ADR-0012).
- **Known limit, accepted by Peter on 2026-10-20:** the presets' source imports its own files with no file extension, as all code in this repo does. Bun loads it; real Node cannot ("Cannot find module"). So in this repo, an editor's oxc extension that starts oxlint or oxfmt on Node cannot load the root configs. Other repos import the built package, which loads under Node (task 6, `3ecbb09`).

## `formatRepoConfig` writes oxfmt's layout

A change to `packages/cli/src/repo/config.ts`, at Peter's choice (open question 18). The layout rules come from oxfmt 0.68.0 with the preset (note 08, section 4, and a probe on 2026-10-20):

- A repo kind's line that fits in 100 columns stays on one line, as now.
- A longer line opens the kind's object, one field per line. Its list stays on one line when it fits there; otherwise it puts one item per line.

The width is a constant in `config.ts` with a comment that names the preset. `@acmelabs/cli` does not depend on `@acmelabs/config`; the sample-repo test catches a drift.

The rule for every later module goes into `spec/README.md`: every file `acmelabs` writes passes the format check unchanged.

## Commands

The module adds no `acmelabs` command.

```
bun run check                                  # the gate; unchanged
bun run --filter @acmelabs/config build        # packages/config/dist: oxlint.js, oxfmt.js and their .d.ts
bun test packages/config                       # the sample-repo tests alone
```

## Project structure

```
bunfig.toml                                   [run] bun = true (ADR-0012)
oxlint.config.ts, oxfmt.config.ts             this repo's thin callers, by relative path
tsconfig.json                                 extends ./packages/config/tsconfig.json
packages/config/                              @acmelabs/config
  package.json
  README.md
  tsconfig.json                               the TypeScript preset, shipped as it is
  scripts/build.ts                            bun build and tsc declarations into dist/
  src/deviation.ts                            Deviation, and the settings built from a list of them
  src/oxlint.ts                               the lint preset and its deviations
  src/oxfmt.ts                                the format preset and its deviations
  src/__tests__/sample-repo.ts                the seam: build once, write a sample repo, run a tool
  src/__tests__/oxlint.test.ts
  src/__tests__/oxfmt.test.ts
  __tests__/tsconfig.test.ts                  the TypeScript preset, beside the file it tests
packages/cli/src/repo/config.ts               formatRepoConfig, with oxfmt's layout
packages/cli/src/repo/__tests__/config.test.ts   adds the cases that run oxfmt through the seam
```

## Code style

As in `repo-model` and `command-core`: `type` for object shapes, function declarations with helpers above their callers, every export has a doc comment whose first line says what it is, Bun APIs, 100 columns, trailing commas. The lint preset reads like this:

```ts
/** The rules in which the ACMElabs preset differs from Ultracite's core preset. */
export const lintDeviations = {
  "func-style": {
    setting: "off",
    reason:
      "Function declarations, with helpers above their callers: Ultracite's no-use-before-define requires that order.",
  },
  // ... sort-keys, no-await-in-loop, typescript/consistent-type-definitions
} satisfies Record<string, Deviation<RuleSetting>>;

/** The ACMElabs lint preset: Ultracite's core preset and the deviations above. */
export default defineConfig({
  extends: [core],
  // `extends` does not pass ignorePatterns on, so Ultracite's list is named here.
  ignorePatterns: core.ignorePatterns,
  rules: settingsOf(lintDeviations),
});
```

## Testing strategy

The sample-repo seam, new in this module (Peter, 2026-10-20). The three agreed seams test a command, a command line or a screen; this module has none of them. A test writes a sample repo in a temp folder, with the thin callers above, a `bunfig.toml` with `run.bun`, and a `node_modules` that holds the built `@acmelabs/config` and links to this repo's installed tools. No network is used. The test then runs `bun run lint`, `bun run format:check`, `bun run format` or `bun run typecheck` in the sample repo and checks the exit code and the messages. Every run puts a `node` first on PATH that fails when anything calls it, so each test also proves that no check runs on Node. Measured on 2026-10-20: oxlint 0.09 s, oxfmt 0.07 s, tsc 0.88 s. The package is built once per test run.

Cases:

- **Lint:** an `interface` fails with `consistent-type-definitions` and a `type` passes; a function declaration above its caller passes; unsorted object keys pass; `await` in a loop passes; `==` fails with `eqeqeq`, so Ultracite's rules still apply; a file under `dist/` is not linted; a thin caller with `extends` and an extra ignored folder keeps the preset's rules and skips that folder.
- **Format:** a 95-column line stays unchanged; a multi-line call gets trailing commas everywhere; imports in the wrong order fail, so Ultracite's options still apply; a file under `dist/` is not checked.
- **TypeScript:** `Bun.file` type-checks; an unchecked index read fails (`noUncheckedIndexedAccess`); a type-only import without `type` fails (`verbatimModuleSyntax`); the sample repo's own `include` decides which files are checked.
- **No Node:** with `run.bun` removed from the sample repo, the failing `node` is called and the run fails. This proves the check is live.
- **Reasons:** every rule and option in which the presets differ from Ultracite's has a deviation with a non-empty reason; the README lists each deviation; every option in the TypeScript preset has a comment line above it.
- **`formatRepoConfig`:** oxfmt with the preset leaves the output unchanged for a plugin-only config, all four hosts, one package, a library line of 101 columns, five packages, and both kinds together. oxfmt in write mode turns the one-line form of the 100-column, 101-column and five-package cases into `formatRepoConfig`'s text, so a format width above or below 100 fails a test (review finding 1, task 9). The existing read-back and byte-identical tests stay.

## Boundaries

- **Always:** a deviation has its reason in the package, beside its setting.
- **Always:** each repo lists `oxlint`, `oxfmt`, `typescript` and `@types/bun` itself, at the preset's versions.
- **Always:** every check in the gate runs on Bun, never on a Node that happens to be on PATH.
- **Ask first:** a new deviation, a removed one, or a tool version bump. Each one changes every ACMElabs repo's results.
- **Never:** a preset that names a path of one repo; repo-specific settings stay in that repo's thin caller, with their reasons.

## User stories

1. As a repo's maintainer, I want my lint config to be one import, so that a fix to the shared rules reaches my repo with one version bump.
2. As a repo's maintainer, I want my format config to be one import, so that every ACMElabs repo formats code the same way.
3. As a repo's maintainer, I want my tsconfig to extend one preset and name only my folders, so that the compiler options never drift between repos.
4. As a repo's maintainer, I want each deviation from Ultracite with its reason, so that I know why a rule is off before I think about turning it on.
5. As a repo's maintainer, I want to add my own ignored folders with their reasons, so that vendored files stay out of my gate without a copy of the preset.
6. As a repo's maintainer, I want the gate to run on Bun even when Node is installed, so that my results match every other machine and CI.
7. As Peter, I want a test to prove that no check calls Node, so that the Bun-only rule holds in fact, not in name.
8. As a repo's maintainer, I want the tool versions named by the preset, so that I know which oxlint and oxfmt its rules were written for.
9. As a repo's maintainer, I want my `oxlint` and `oxfmt` commands to work with any Bun linker, so that a workspace repo and a single-package repo set up the same way.
10. As a repo's maintainer, I want to stop listing Ultracite, so that one less version can drift.
11. As the `scaffold` module, I want the exact text of each thin caller, so that a new repo starts on the presets with no copied config.
12. As the `jev-gate-migration` module, I want the presets to give jev-gate's current results, so that the migration changes no behaviour.
13. As brain's maintainer, I want the presets to give brain's current results, so that brain's later migration changes no behaviour.
14. As the `cli-release` module, I want `@acmelabs/config` to build into JavaScript and type files, so that I can pack, test and publish it.
15. As the `upgrade` module, I want one exact pin of `@acmelabs/config` per repo, so that an upgrade bumps one line and the tools it names.
16. As a maintainer of this repo, I want this repo on its own presets, so that a broken preset breaks this repo's gate first.
17. As a maintainer of this repo, I want the gate to need no build step, so that a fresh clone checks right after `bun install`.
18. As a reviewer, I want the presets tested in a sample repo with the real tools, so that a preset that looks right but loses a setting fails a test.
19. As a reviewer, I want a test that fails when a deviation has no reason, so that no setting changes silently.
20. As a library repo's maintainer, I want `acmelabs.json` to keep the layout that the format check gives it, so that my repo can format every file and see no churn.
21. As the author of a later command, I want the rule that every file `acmelabs` writes passes the format check unchanged, so that my writer has a clear target.
22. As an editor user, I want the presets to load under Node too, so that my editor's oxlint extension reads the same rules.

## Out of scope

- Presets for frameworks (React, Lit, Vue): Ultracite's core preset only. design-system keeps its own configs.
- New deviations, removed deviations or tool version bumps.
- Publishing `@acmelabs/config`, and the packed-package test before a publish: `cli-release`.
- The scope of each repo's lint and format scripts (which folders they cover): `scaffold`.
- Moving jev-gate or brain onto the presets: `jev-gate-migration` and a later pass.
- Proving `run.bun` on Linux in CI: `shared-workflows`.
- An editor extension's runtime: it starts the tools outside `bun run`, so ADR-0012 does not reach it.
- A shared library-build preset (a tsconfig for `.d.ts` output): `@acmelabs/config` builds itself; `cli-release` decides whether `@acmelabs/cli` shares that build.

## Prior-art tests

- brain `scripts/version/__tests__/version-sync.test.ts`: fixture repos in a temp folder, real files, a byte-identical second write.
- `packages/cli/scripts/__tests__/schema.test.ts`: a temp folder made in `beforeAll` and removed in `afterAll`.
- `packages/cli/src/repo/__tests__/config.test.ts`: `formatRepoConfig` read-back and byte-identical cases, which the oxfmt cases join.

## Success criteria

- [ ] `@acmelabs/config` builds into `dist/oxlint.js`, `dist/oxfmt.js` and their `.d.ts` files, and ships `tsconfig.json`.
- [ ] In a sample repo, the thin callers above give the lint, format and TypeScript results listed under "Testing strategy".
- [ ] Every check in those tests runs with a `node` first on PATH that fails when called, and passes; without `run.bun`, the same run fails.
- [ ] Every deviation has a reason, and the README lists each one; every TypeScript preset option has its reason comment.
- [ ] This repo's root configs use the presets, the root lists no `ultracite`, and `bunfig.toml` holds `run.bun`.
- [ ] In this repo, `bun run check` passes with a `node` first on PATH that fails when called.
- [ ] oxfmt with the preset leaves `formatRepoConfig`'s output unchanged for the six cases above, and turns the one-line form into `formatRepoConfig`'s text.
- [ ] `spec/README.md` holds the sample-repo seam and the rule that every file `acmelabs` writes passes the format check unchanged.
- [ ] A changeset records `@acmelabs/config`, and `bun run check` is green.

## Open questions

1. After `changeset version`, `packages/cli/CHANGELOG.md` and `packages/config/CHANGELOG.md` sit under `packages`, which this repo's format check covers. Does the changelog that changesets writes pass `oxfmt --check`? If not, the gate fails on the Version Packages PR. Decide in `cli-release`.
2. ~~Does `tsc` resolve `extends: "@acmelabs/config/tsconfig.json"` through the package's `exports`?~~ Answered by task 5 (`23b0fa4`), with tsc 5.9.3 in the hoisted layout: yes, through `exports` only. The thin caller works as written. The package needs both the `./tsconfig.json` entry in `exports` and the file in `files`: with the file on disk and no `exports` entry, tsc fails with `TS6053`.
3. ~~Ultracite's oxlint preset imports `defineConfig` from `oxlint` at run time, and lists oxlint as an optional peer. Does Bun's isolated linker give Ultracite the repo's oxlint through `@acmelabs/config`?~~ Answered: yes in the hoisted layout (task 2) and through this repo's isolated install (task 6, `3ecbb09`). Since ADR-0013 the bundled presets import `oxlint` and `oxfmt` from the package itself, so the question no longer applies to a repo.
