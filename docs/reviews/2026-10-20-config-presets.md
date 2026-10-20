# Review: the config-presets module

The final-checkpoint review of module `config-presets` (`/brain:review`, the five-axis review of `code-review-and-quality`), run on 2026-10-20 before the module's PR into `main`.

**Verdict: request changes.** The approach is sound, and every success criterion in the spec passes. Two Required findings stand: one test gap and one stale record.

## Context

| Item | Value |
|---|---|
| Fixed point | merge-base `b09cdc6` (= `main`); diff `git diff b09cdc6...HEAD`; 14 commits, 30 files, about 1,800 added lines (about 900 of them tests, docs and `tasks/todo.md`) |
| Spec | `spec/SPEC-config-presets.md`, plus Peter's decisions in `docs/design/spec-interview.md`, ADR-0012 and `tasks/todo.md` |
| Standards | `AGENTS.md`, `CLAUDE.md`, `spec/README.md` ("Rules for every module", "Test seams"), the spec's "Code style", the presets themselves, `CONTEXT.md` |
| Axes | correctness, readability, architecture, security, performance: five parallel sub-agents on Sonnet, a different model from the one that wrote the code; plus the orchestrator's own test review and the task reports |

## Verification story

- `bun run check` is green: typecheck, lint, format check, schema check, 206 tests. The orchestrator re-ran it after every task.
- The gate is green with a `node` first on PATH that fails when called, and no check calls it (ADR-0012). It is green on a clean clone of the branch too.
- Each test went red first. Where a test guarded behaviour an earlier task had built, its task broke the code for one run, saw the test fail, and restored it (task reports 3, 4, 7, 8).
- Spec open questions 2 and 3 are answered: tsc follows the thin caller's `extends` through `exports` only (task 5); Ultracite's run-time imports resolve in the hoisted layout (task 2) and through this repo's isolated install (task 6).
- Performance, measured: `bun test` takes 2.7 to 3.1 s (was about 0.18 s). The three sample-repo test files cause the rise, as the seam Peter chose implies. The build takes 0.64 s, once per test run.

## Findings, ranked by leverage

### Required

1. **The width-drift test catches only a narrower width.** `[hard: spec/SPEC-config-presets.md, "formatRepoConfig writes oxfmt's layout": "the sample-repo test catches a drift"]` (correctness; the orchestrator's test review; task 7's report)
   `packages/cli/src/repo/config.ts:203-208` and the new sample-repo case in `config.test.ts`. With a preset `printWidth` of 120, all eight cases still pass `format:check`, because oxfmt keeps an open object open. Only a width below 100 fails.
   Fix: a sample-repo test that runs oxfmt in write mode on the one-line form of the 101-column and five-package cases, then expects `formatRepoConfig`'s text. A wider or a narrower width then fails.

2. **`docs/STATUS.md` on the branch says no task is done.** `[hard: AGENTS.md, "Session end" step 2: "Done when a new session can continue from it alone"]` (correctness)
   It says "8 tasks, none done yet", "Task 1 first", and "The gate runs on Node today". All three are false now.
   Fix: rewrite it after the review fixes, at the session end.

### Optional and Consider

3. **Consider: Ultracite's own dependency tree reaches every repo.** (security) `packages/config/package.json`: `"ultracite": "7.12.0"` brings 17 packages with caret ranges (`execa`, `commander`, `@clack/prompts` and others), and the presets use two of Ultracite's config files. Every ACMElabs repo installs the same tree today, so this adds no new exposure. Bundling Ultracite's two presets into `dist` would remove the tree from every repo; Ultracite would become a devDependency, and the package would carry Ultracite's MIT notice.
   Recommendation: decide in `cli-release`, which settles the published package and tests it packed. Recorded as an open question.
4. **Optional: the root's tool pins and the preset's peers are two copies.** (architecture) `package.json` and `packages/config/package.json` both name `oxlint` 1.83.0, `oxfmt` 0.68.0, `typescript` and `@types/bun`. The sample-repo tests link the root's installed tools, so a bump at the root alone would test the preset against a version it does not declare.
   Fix: a test that the root's four devDependencies equal the preset's peer dependencies.
5. **Optional: the build restates six preset options as tsc flags.** (readability, architecture) `packages/config/scripts/build.ts:15-37`. The comment explains why, and the copies can drift.
   Fix: a build tsconfig that extends the preset and turns on the type-file output, so the build uses the preset it ships.
6. **Optional: the root typecheck reads local build output.** (task 6; verified) `tsconfig.json`: `include: ["packages/**/*.ts"]` matches `packages/config/dist/*.d.ts` after a local build, so a stale build can change the result.
   Fix: `"exclude": ["packages/*/dist"]` in the root `tsconfig.json`.
7. **Consider: `configOnlyTsconfig` is written twice.** (readability) `oxlint.test.ts:27` and `oxfmt.test.ts:34` hold the same 15 lines, apart from `include`.
   Fix: one helper in `sample-repo.ts`, beside the thin callers.
8. **Optional: `ultraciteIgnorePatterns()` is written twice,** in `oxlint.ts` and `oxfmt.ts`, each over a different Ultracite preset. (readability, architecture) The reviewers split. Recommendation: keep it until a third preset needs it.

### Nit

9. `packages/config/tsconfig.json:7-10`: the `module` and `moduleResolution` comments are one sentence twice. Fix: one reason for each option. (readability)
10. `.changeset/README.md:37` says `@acmelabs/config` "arrives with the `config-presets` module". It goes stale at the merge. (task 8)
11. `AGENTS.md:64` lists the gate as "typecheck, oxlint, oxfmt check, tests, version check". The `check` script runs a schema check and no version check. (task 1)
12. `docs/research/07-oxc-without-node.md`, section 4, names only `CLAUDECODE`. `AI_AGENT` changes oxlint's output the same way. (tasks 1 and 6)
13. The spec's `env` sentence was made exact in `a0a733d` ("The preset sets no `env`, as today's configs do"), with no line in the interview record. It matches the sentence's own reason and today's configs. Fix: one line in `docs/design/spec-interview.md`. (correctness)
14. `packages/config/scripts/build.ts`: `buildPackage` empties any folder it gets. Both callers pass `dist` or a fresh temp folder. Recommendation: no change. (security)

### FYI

15. Neither package folder has a `LICENSE`. npm ships the license file from the package folder, so a publish needs one. Recorded as an open question for `cli-release`. (task 8)
16. `formatRepoConfig` counts columns as oxfmt does (`Bun.stringWidth`). Task 7 probed CJK, emoji and accented letters against oxfmt; the test covers CJK. The comma that follows a repo kind counts toward the fit, as probed, though no valid config reaches that edge today. (correctness, task 7)
17. The root `oxlint.config.ts` and `oxfmt.config.ts` are not type-checked: the root `include` covers `packages/` only. This was true before the module. (task 6)
18. After the root dropped `ultracite`, `bun install` kept a stale `node_modules/ultracite` at the root; only a fresh install removed it. Whether this is a Bun bug is UNVERIFIED. (task 6)

## Claims checked and dropped

- "Nothing outside their own file reads `lintDeviations` and `formatDeviations`" (architecture). Wrong: `oxlint.test.ts`, `oxfmt.test.ts` and `readme.test.ts` read them, so the data earns its place.
- "The lint reasons test cannot fail" (correctness). Wrong: task 3 added `"no-console": "error"` to the preset's `rules`, and the test failed with `["no-console"]`.
- "The comma logic sits in two places and could be one" (readability). The fit check needs the comma's width, as task 7's probe showed, so the parameter stays.

## Re-check after the fixes

Run on 2026-10-20 by the orchestrator, after tasks 9 to 13 (the fixes Peter chose). **Verdict: approve.**

| Finding | Outcome |
|---|---|
| 1 The width-drift test | Fixed in `2fa9c6b` (task 9). oxfmt in write mode turns the one-line form of the 100-column, 101-column and five-package cases into `formatRepoConfig`'s text. A preset width of 120 and of 90 each made the test fail (mutation runs, undone). The 100-column case was needed: with the two named cases only, 90 passed. |
| 2 The stale handoff note | Fixed at the session end, with this re-check. |
| 3 Ultracite's tree in every repo | Fixed in `a6f99c6` (task 10, ADR-0013). The built presets import only `oxlint` and `oxfmt`; Ultracite is a devDependency; `THIRD-PARTY-NOTICES.md` holds Ultracite's `license.md` from tag `ultracite@7.12.0`, byte for byte; a sample repo with no Ultracite lints and formats. Under real Node, the built presets load with no Ultracite installed. |
| 4 The tool pins | Fixed in `1a6bcff` (task 12): a test proves the root's four tools equal the preset's peers. |
| 5 The build restated preset options | Fixed in `d0e1c6c` (task 11): `tsconfig.build.json` extends the preset; the built `.d.ts` files are byte-identical before and after. |
| 6 The root typecheck read local build output | Fixed in `1a6bcff`: the root `tsconfig.json` excludes `packages/*/dist`; `--showConfig` lists no `dist` file and no `node_modules` file. |
| 7 The duplicated test tsconfig | Fixed in `1a6bcff`: one `configOnlyTsconfig(file)` in `sample-repo.ts`. |
| 8 `ultraciteIgnorePatterns()` twice | Kept, as recommended. |
| 9 The `module` and `moduleResolution` comments | Fixed in `d0e1c6c`: one reason each, checked with a tsc probe; the README's and the spec's tables have one row per option. |
| 10 to 12 Stale records | Fixed in `3ba22ba` (`.changeset/README.md`) and on `main` in `c915de8` (`AGENTS.md` now names the `check` script instead of a copy of its steps; note 07 names `AI_AGENT`). |
| 13 The `env` sentence's source | Recorded in `docs/design/spec-interview.md` (`50c58bb`). |
| 14 `buildPackage` empties its folder | Kept, as recommended. |
| 15 No `LICENSE` per package | Open question 24 in `spec/README.md`, for `cli-release` (`c915de8`). |

Also fixed: two lines over 100 columns (the build banner, in `1a6bcff`; a doc comment, in `588cea9`), and the spec's build comment now names `deviation.d.ts`.

Verification: `bun run check` is green with 213 tests, normally, with a failing `node` first on PATH, and on a clean clone of the branch.

### New FYI from the fixes

- The built JavaScript holds comments with each bundled module's path, which include the install store's hash and depend on the build's working folder. Two builds can differ in those comments only. A byte-for-byte compare of release builds belongs to `cli-release` and should build from one fixed folder. (task 10)
- `repo-model`'s test "reads a list of 10,000 distinct package paths in under 100 ms" took 132 ms once while other tests ran on the same machine; quiet runs take 37 to 45 ms. A wall-clock limit in a unit test is flaky under load. (found during task 13)
- Some test names pass 100 columns. oxfmt does not split strings, and the gate passes. (task 12)
