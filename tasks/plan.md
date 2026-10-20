# Implementation plan — config-presets

Status: **draft**, waiting for Peter's answers to the three plan questions. Written from `spec/SPEC-config-presets.md`, approved on 2026-10-20. Words follow `CONTEXT.md`. The task details, with acceptance criteria and checks, are in `tasks/todo.md`.

## Overview

`config-presets` makes `@acmelabs/config`: the lint, format and TypeScript presets, each deviation with its reason, tested in a sample repo with the real tools. It moves the gate onto Bun (ADR-0012), moves this repo onto its own presets, and makes `formatRepoConfig` write oxfmt's layout. Eight tasks, each a vertical slice that leaves `bun run check` green, built on branch `config-presets` and merged into `main` through one PR.

| Phase | Tasks | Ends at |
|---|---|---|
| 1. The gate on Bun, and a first preset end to end | 1–2 | Checkpoint: a sample repo lints with the built lint preset, and no check calls Node |
| 2. The three presets | 3–5 | Checkpoint: every preset case in the spec's "Testing strategy" passes |
| 3. The presets in use | 6–8 | Checkpoint: every success criterion in the spec passes; `/brain:review`; PR into `main` |

## Architecture decisions

The spec settles the presets and the seam. These are the plan's own calls; each is small and reversible.

| Decision | Reason |
|---|---|
| Task 1 is the `bunfig.toml` line alone. | It is the prefactor: every later task's gate then runs on Bun, so a tool that breaks on Bun shows at once. |
| Task 2 is a tracer bullet: the lint preset, its build and the sample-repo seam together, with two lint cases. | The riskiest path is "a repo imports the built preset and the tools run on Bun". None of the three parts can be proven alone. |
| Deviations become data in task 3, after the tracer works. | Task 2 stays an M; task 3 turns the four rules into data and adds the full lint cases and the reasons test. |
| The sample repo's `node_modules` is made by the test helper: the built package copied in, and links to this repo's installed tools, in the hoisted layout. | No network, and the hoisted layout is Bun's default for a single-package repo such as a plugin repo. Task 6 proves the isolated layout in this repo's own workspace. A real install from the packed package stays with `cli-release`. |
| The package builds once per test run, into a temp folder. | `bun test` runs every file in one process, so one build serves every sample-repo test. |
| Each sample-repo run sets its own environment: a PATH of the failing `node`, Bun's folder and the system folders, and no `CLAUDECODE`. | oxlint prints a different format when `CLAUDECODE=1` (note 07, section 4); a fixed environment keeps the messages stable. |
| The changeset for `@acmelabs/config` comes with its README, in task 8; the `formatRepoConfig` change gets its own changeset line in task 7. | Each user-facing change gets a changeset in the task that makes it. |
| Task 8 also corrects the stale status lines of the root `README.md` and `packages/cli/README.md` (they still say `repo-model` is being built). | The README rule says a package's README describes its current state; this task already edits the READMEs. |

## Order of work

```
1 The gate runs on Bun in this repo
2 A sample repo lints with the built lint preset
├── 3 Every lint deviation has its reason, and the lint results match today's
├── 4 A sample repo formats with the format preset
│   └── 7 formatRepoConfig writes oxfmt's layout
└── 5 A sample repo type-checks with the TypeScript preset
6 This repo's gate uses its own presets          (needs 1, 3, 4, 5)
8 The @acmelabs/config README and changeset      (needs 3, 4, 5)
```

Task 1 needs nothing. Tasks 3, 4 and 5 each need only task 2, so they can run in parallel. Task 4 builds on task 3's `Deviation` type when task 3 is done first; otherwise task 4 adds it.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The hand-made `node_modules` resolves differently from a real install (spec open question 3) | Medium | Task 6 proves the isolated layout in this repo's workspace, through its own gate. `cli-release` tests the packed package with a real install before the first publish. |
| `tsc` does not follow `extends` through the package's `exports` (spec open question 2) | Low | The package exports `./tsconfig.json`, which is also a real file path. Task 5 tests the thin caller as written; if it fails, the task changes the thin caller and the spec before `scaffold` uses it. |
| The build of the `.d.ts` files fights the preset's `noEmit` | Low | `scripts/build.ts` passes its own `tsc` flags; task 2 checks the files exist and type a thin caller. |
| The sample-repo tests make `bun test` slower (oxlint 0.09 s, oxfmt 0.07 s, tsc 0.88 s per run, plus one build) | Low | One build per run; each test sets a timeout above the default 5 s where it runs tsc or builds. |
| A test's failing `node` hides a real failure message | Low | The failing `node` prints a fixed line; a test that expects success also asserts that line is absent. |

## Open questions

None block this plan. Spec open question 1 (changelogs under `packages`) belongs to `cli-release`; spec open questions 2 and 3 are answered by tasks 5 and 6.
