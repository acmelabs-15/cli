# Tasks — config-presets

The task list for `tasks/plan.md`. Tick a task in the checklist, and each box inside its section, when it meets its acceptance criteria and the Definition of Done (brain's `references/definition-of-done.md`). Each task ends with `bun run check` green and one commit on branch `config-presets`, pushed.

"With the failing `node`" means: a folder that holds an executable `node` that prints `REAL NODE WAS CALLED` and exits 99 comes first on PATH.

## Checklist

Phase 1 The gate on Bun, and a first preset end to end

- [x] 1. The gate runs on Bun in this repo
- [x] 2. A sample repo lints with the built lint preset
- [x] Checkpoint: the seam works

Phase 2 The three presets

- [x] 3. Every lint deviation has its reason, and the lint results match today's
- [x] 4. A sample repo formats with the format preset
- [x] 5. A sample repo type-checks with the TypeScript preset
- [x] Checkpoint: the presets

Phase 3 The presets in use

- [x] 6. This repo's gate uses its own presets
- [x] 7. formatRepoConfig writes oxfmt's layout
- [x] 8. The @acmelabs/config README and changeset

Phase 4 Review fixes (Peter chose them on 2026-10-20; `docs/reviews/2026-10-20-config-presets.md`)

- [x] 9. The width-drift test fails for a wider or a narrower width
- [x] 10. The presets bundle Ultracite's presets
- [x] 11. The build uses the TypeScript preset, and each option has its own reason
- [x] 12. The tool pins, the root typecheck and the test tsconfig stay true to the preset
- [x] 13. Record fixes
- [x] Checkpoint: config-presets complete

## Task 1: The gate runs on Bun in this repo

**Description:** A root `bunfig.toml` with `[run]` and `bun = true` (ADR-0012). From here on, every check in `bun run check` runs on Bun, also on a machine with Node on PATH.

**Acceptance criteria:**
- [x] `bunfig.toml` holds `[run]` and `bun = true`, with a comment that names ADR-0012.
- [x] `bun run check` passes with the failing `node`, and its output has no `REAL NODE WAS CALLED`.
- [x] With `bunfig.toml` moved away, `bun run typecheck` with the failing `node` exits non-zero with `REAL NODE WAS CALLED`. This proves the check is live.

**Verification:**
- [x] `bun run check` is green, read from its own exit code.
- [x] The two runs above, with their output kept in the task's report.

**Dependencies:** None

**Files likely touched:** `bunfig.toml`

**Estimated scope:** XS

## Task 2: A sample repo lints with the built lint preset

**Description:** The tracer bullet. `packages/config` becomes `@acmelabs/config` with the lint preset: Ultracite's core through `extends`, its ignore list named again, and the four deviations as plain rules, ported from today's root config. `scripts/build.ts` builds it into JavaScript and a `.d.ts` file. The sample-repo seam exists: a helper builds the package once, writes a sample repo with a thin caller, a `bunfig.toml` with `run.bun` and a hand-made `node_modules`, and runs a script with the failing `node`.

**Acceptance criteria:**
- [x] `bun run --filter @acmelabs/config build` writes `dist/oxlint.js` and `dist/oxlint.d.ts`; `package.json` has the spec's name, `private`, `exports` for `./oxlint`, `files`, `ultracite` 7.12.0 as a dependency and the four peer dependencies; `dist/` is in `.gitignore`.
- [x] In a sample repo whose `oxlint.config.ts` is the spec's one-line thin caller, `bun run lint` fails on an `interface` with `consistent-type-definitions` and passes on the same shape as a `type`, with no `REAL NODE WAS CALLED`.
- [x] Without `run.bun` in the sample repo, a run that starts a `node`-shebang tool calls the failing `node` and fails. This proves the seam's Node check is live.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/config`
- [x] `bun run check` is green.

**Dependencies:** None (task 1 first by order)

**Files likely touched:** `packages/config/package.json`, `packages/config/src/oxlint.ts`, `packages/config/scripts/build.ts`, `packages/config/src/__tests__/sample-repo.ts`, `packages/config/src/__tests__/oxlint.test.ts`, `.gitignore`, `bun.lock`

**Estimated scope:** Medium

## Checkpoint: the seam works

- [x] `bun run check` is green, with the failing `node` too.
- [x] The tracer answers the riskiest question: a sample repo imports the built lint preset by package name, and oxlint runs it on Bun.

## Task 3: Every lint deviation has its reason, and the lint results match today's

**Description:** The `Deviation` type and the settings built from a list of them. The lint preset's four deviations become data with the spec's reasons. The lint cases from the spec's "Testing strategy" prove that the preset gives today's results, and a test proves every difference from Ultracite has a reason.

**Acceptance criteria:**
- [x] `lintDeviations` holds the four deviations with the spec's settings and reasons, and the preset's `rules` are built from it.
- [x] In a sample repo: a function declaration above its caller passes; unsorted object keys pass; `await` in a loop passes; `==` fails with `eqeqeq`; a file under `dist/` is not linted; the spec's `extends` thin caller with one more ignored folder keeps the preset's rules and skips that folder.
- [x] A test compares the preset's rules with Ultracite core's: every rule that differs is in `lintDeviations` with a non-empty reason, and every deviation differs.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/config`
- [x] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/config/src/deviation.ts`, `packages/config/src/oxlint.ts`, `packages/config/src/__tests__/oxlint.test.ts`

**Estimated scope:** Small

## Task 4: A sample repo formats with the format preset

**Description:** The format preset: Ultracite's oxfmt preset spread, with `printWidth` 100 and `trailingComma` `"all"` as deviations with their reasons. The build and the exports add `./oxfmt`. The format cases from the spec run in a sample repo.

**Acceptance criteria:**
- [x] The build writes `dist/oxfmt.js` and `dist/oxfmt.d.ts`; `exports` has `./oxfmt`; the preset's type says `ignorePatterns` is always present.
- [x] In a sample repo with the one-line thin caller: a 95-column line stays unchanged; a multi-line call gets trailing commas everywhere; imports in the wrong order fail; a file under `dist/` is not checked. The spec's spread thin caller with one more ignored folder skips that folder.
- [x] A test compares the preset with Ultracite's: every option that differs is in `formatDeviations` with a non-empty reason, and every deviation differs.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/config`
- [x] `bun run check` is green.

**Dependencies:** 2 (and task 3's `Deviation` type when task 3 is done)

**Files likely touched:** `packages/config/src/oxfmt.ts`, `packages/config/scripts/build.ts`, `packages/config/package.json`, `packages/config/src/__tests__/oxfmt.test.ts`

**Estimated scope:** Medium

## Task 5: A sample repo type-checks with the TypeScript preset

**Description:** `packages/config/tsconfig.json` holds the spec's `compilerOptions`, each with a comment line that gives its reason, and no `include`. The package exports and ships it. A sample repo whose `tsconfig.json` is the spec's thin caller type-checks on Bun. This answers spec open question 2.

**Acceptance criteria:**
- [x] `exports` has `./tsconfig.json`, and `files` ships it.
- [x] In a sample repo with the thin caller: `Bun.file` type-checks; an unchecked index read fails; a type-only import without `type` fails; a file outside the sample repo's `include` is not checked.
- [x] A test reads the preset's text: every option under `compilerOptions` has a comment line directly above it, and the file has no `include`.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/config`
- [x] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/config/tsconfig.json`, `packages/config/package.json`, `packages/config/__tests__/tsconfig.test.ts`, `packages/config/src/__tests__/sample-repo.ts`

**Estimated scope:** Medium

## Checkpoint: the presets

- [x] `bun run check` is green, with the failing `node` too.
- [x] Every lint, format, TypeScript, "No Node" and "Reasons" case in the spec's "Testing strategy" passes, except the README check (task 8).
- [x] Spec open question 2 has its answer in task 5's report.

## Task 6: This repo's gate uses its own presets

**Description:** The root `oxlint.config.ts` and `oxfmt.config.ts` import the presets' source by relative path, and the root `tsconfig.json` extends `./packages/config/tsconfig.json`. The root drops `ultracite` from its devDependencies. This repo's isolated install answers spec open question 3 for a workspace repo.

**Acceptance criteria:**
- [x] The three root files are thin callers by relative path, each with a comment that says why; the root `package.json` lists no `ultracite`.
- [x] `bun run check` passes with the failing `node`.
- [x] Two probes, removed after: an `interface` under `packages/` fails `bun run lint` with `consistent-type-definitions`, and two imports in reverse order fail `bun run format:check`. This proves both configs load.

**Verification:**
- [x] `bun run check` is green, read from its own exit code.
- [x] The probe runs, with their output kept in the task's report.

**Dependencies:** 1, 3, 4, 5

**Files likely touched:** `oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.json`, `package.json`, `bun.lock`

**Estimated scope:** Small

## Task 7: formatRepoConfig writes oxfmt's layout

**Description:** `formatRepoConfig` keeps a repo kind's line when it fits in 100 columns. A longer line opens the kind's object, one field per line, and its list stays on one line when it fits there, else one item per line. A sample-repo test runs oxfmt with the format preset on the output.

**Acceptance criteria:**
- [x] oxfmt with the format preset leaves the output unchanged for a plugin-only config, all four hosts, one package, a library line of 101 columns, five packages, and both kinds together.
- [x] The width is a constant in `config.ts` with a comment that names the preset; the existing read-back and byte-identical tests still pass.
- [x] A changeset for `@acmelabs/cli` says that `acmelabs.json` keeps the layout the format check gives it.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/repo`
- [x] `bun run check` is green.

**Dependencies:** 4

**Files likely touched:** `packages/cli/src/repo/config.ts`, `packages/cli/src/repo/__tests__/config.test.ts`, `.changeset/acmelabs-json-layout.md`

**Estimated scope:** Small

## Task 8: The @acmelabs/config README and changeset

**Description:** `packages/config/README.md` says what the package is, how to install it, the thin callers from the spec, `bunfig.toml` with a pointer to ADR-0012, and the table of deviations with their reasons. A test proves the README lists each deviation. A changeset records the new package. The stale status lines of the root and `packages/cli` READMEs are corrected.

**Acceptance criteria:**
- [x] The README holds the spec's thin callers and one table row per deviation, with its reason.
- [x] A test fails when a deviation in `lintDeviations` or `formatDeviations` is missing from the README.
- [x] `.changeset/config-presets.md` records `@acmelabs/config` as a minor change; the root and `packages/cli` READMEs state the current modules.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/config`
- [x] `bun run check` is green.

**Dependencies:** 3, 4, 5

**Files likely touched:** `packages/config/README.md`, `packages/config/src/__tests__/readme.test.ts`, `.changeset/config-presets.md`, `README.md`, `packages/cli/README.md`

**Estimated scope:** Medium

## Task 9: The width-drift test fails for a wider or a narrower width

**Description:** Review finding 1 (Required). The spec says "the sample-repo test catches a drift" of the format width, but a preset `printWidth` above 100 passes today, because oxfmt keeps an open object open. A sample-repo test runs oxfmt in write mode on the one-line form of the 101-column and five-package cases, then expects `formatRepoConfig`'s text.

**Acceptance criteria:**
- [x] The new test passes, and oxfmt's output for each case equals `formatRepoConfig`'s text byte for byte.
- [x] With the format preset's `printWidth` set to 120 for one run, the test fails; with 90, it fails too. Both changes are undone before the commit.
- [x] The spec's sentence "the sample-repo test catches a drift" is true as written.

**Verification:**
- [x] The mutation runs, with their output kept in the task's report.
- [x] `bun run check` is green.

**Dependencies:** None

**Files likely touched:** `packages/cli/src/repo/__tests__/config.test.ts`

**Estimated scope:** Small

## Task 10: The presets bundle Ultracite's presets

**Description:** Review finding 3, ADR-0013. The build puts Ultracite's two presets into `dist/oxlint.js` and `dist/oxfmt.js`; `oxlint` and `oxfmt` stay imports. Ultracite becomes a devDependency. The package ships Ultracite's MIT notice. A sample repo has no Ultracite in its `node_modules`.

**Acceptance criteria:**
- [x] `dist/oxlint.js` and `dist/oxfmt.js` import only `oxlint` and `oxfmt`; `package.json` lists `ultracite` under `devDependencies` only.
- [x] Every sample-repo test passes with no Ultracite in the sample repo, and a test proves that it is absent.
- [x] The shipped files hold Ultracite's copyright and permission notice, taken from Ultracite's own license, and a test checks it; the README's "Install" part says the package bundles Ultracite.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/config`
- [x] `bun run check` is green, with the failing `node` too.

**Dependencies:** None

**Files likely touched:** `packages/config/package.json`, `packages/config/scripts/build.ts`, a notice file in `packages/config`, `packages/config/src/__tests__/oxlint.test.ts`, `packages/config/src/__tests__/oxfmt.test.ts`, `packages/config/README.md`, `bun.lock`

**Estimated scope:** Medium

## Task 11: The build uses the TypeScript preset, and each option has its own reason

**Description:** Review findings 5 and 9. A build tsconfig in `packages/config` extends the preset and turns on the type-file output, so `scripts/build.ts` restates no option that the preset sets. The `module` and `moduleResolution` comments in the preset each give that option's own reason, and the README's and the spec's tables match.

**Acceptance criteria:**
- [x] `scripts/build.ts` names no compiler option that the preset sets, and the built `.d.ts` files are byte-identical to the ones before the change.
- [x] The `module` and `moduleResolution` comments differ, each with its own reason; the README's and the spec's TypeScript tables say the same.
- [x] The build tsconfig does not ship: `files` is unchanged.

**Verification:**
- [x] The before-and-after comparison of `dist/*.d.ts`, kept in the task's report.
- [x] `bun run check` is green.

**Dependencies:** 10

**Files likely touched:** `packages/config/scripts/build.ts`, `packages/config/tsconfig.build.json`, `packages/config/tsconfig.json`, `packages/config/README.md`, `spec/SPEC-config-presets.md`

**Estimated scope:** Medium

## Task 12: The tool pins, the root typecheck and the test tsconfig stay true to the preset

**Description:** Review findings 4, 6 and 7. A test proves that the root's four tool versions equal the preset's peer dependencies. The root `tsconfig.json` skips `packages/*/dist`. The two test files share one helper for the tsconfig that type-checks only a sample repo's config file.

**Acceptance criteria:**
- [x] The pins test fails when the root's `oxlint` version differs from the peer (one mutation run, undone).
- [x] With a local build in `packages/config/dist`, `bun run tsc --showConfig` lists no file under `dist`.
- [x] `oxlint.test.ts` and `oxfmt.test.ts` use one helper from `sample-repo.ts`, and no copy remains.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/config`
- [x] `bun run check` is green.

**Dependencies:** 10

**Files likely touched:** `packages/config/__tests__/package.test.ts`, `tsconfig.json`, `packages/config/src/__tests__/sample-repo.ts`, `packages/config/src/__tests__/oxlint.test.ts`, `packages/config/src/__tests__/oxfmt.test.ts`

**Estimated scope:** Medium

## Task 13: Record fixes

**Description:** Review findings 10, 11, 12 and 15. `.changeset/README.md` no longer says that `@acmelabs/config` is still to come. `AGENTS.md` lists the gate as the `check` script runs it. Note 07 names `AI_AGENT` beside `CLAUDECODE`. `spec/README.md` gets an open question for `cli-release`: each package folder needs a `LICENSE`. Finding 13 (the `env` sentence's source) is in `docs/design/spec-interview.md` already.

**Acceptance criteria:**
- [x] Each of the four records says what is true today.
- [x] `AGENTS.md` is edited through the writing-for-agents skill, as `CLAUDE.md` asks.
- [x] Records that belong on `main` (`AGENTS.md`, note 07, `spec/README.md`) go to `main`; `.changeset/README.md` goes with the module branch.

**Verification:**
- [x] `bun run check` is green.

**Dependencies:** None

**Files likely touched:** `.changeset/README.md`, `AGENTS.md`, `docs/research/07-oxc-without-node.md`, `spec/README.md`

**Estimated scope:** Small

## Checkpoint: config-presets complete

- [x] Every success criterion in `spec/SPEC-config-presets.md` passes.
- [x] `bun run check` is green, with the failing `node` too.
- [x] `/brain:review` on the branch, and its findings fixed or recorded.
- [x] Peter reviews; the PR into `main` merges with a merge commit, after he asks for it (PR #3, `7fcb916`).
