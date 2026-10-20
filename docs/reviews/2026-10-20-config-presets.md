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
