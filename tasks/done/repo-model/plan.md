# Implementation plan — repo-model

Status: **approved by Peter on 2026-10-20** through the three plan questions (size right, edges right, no merge or split). Written with `/brain:plan` from `spec/SPEC-repo-model.md`, approved on 2026-10-20. Words follow `CONTEXT.md`. The task details, with acceptance criteria and checks, are in `tasks/todo.md`.

## Overview

`repo-model` is the repo's first code, so the plan has two phases. Phase 1 sets up the repo's own tooling in three small tasks, each leaving `bun run check` green. Phase 2 builds the module in four vertical slices: read and check `acmelabs.json`, the host table, the canonical file text with this repo's own `acmelabs.json`, and the generated JSON schema for editors.

| Phase | Tasks | Ends at |
|---|---|---|
| 1. Foundation | 1–3 | Checkpoint: the gate is green and changesets is set up |
| 2. repo-model | 4–7 | Checkpoint: every success criterion in the spec passes; review with Peter |

## Architecture decisions

The spec and the decision records settle the module. These are the plan's own calls; each is small and reversible.

| Decision | Reason |
|---|---|
| Task 1 ships the first real test with the workspace. | `bun test` exits 1 when there are no tests, and the gate is green before every commit. The four host ids are the smallest real piece of the module. |
| The lint and format configs start as brain's DEC-001 configs, in this repo's root. | `config-presets` has no approved spec yet, so this plan does not build `@acmelabs/config`. That module later moves the configs into the package, and this repo then imports them from there. |
| Tool versions match brain's: oxlint 1.83.0, oxfmt 0.68.0, ultracite 7.12.0. | Both repos then lint and format alike. Newer versions exist (oxlint 1.89.0, oxfmt 0.74.0); moving to them belongs to `config-presets`. |
| `@acmelabs/cli` stays `"private": true` until `cli-release`. | Nothing can publish by accident. changesets still versions it. |
| zod is pinned to an exact version. | The generated schema file then changes only when we change the schema, not on a zod patch release. |
| `bun run check` is typecheck, lint, format check, tests and the schema check. | The version check joins it when `repo-checks` builds `acmelabs version check`. |
| The schema script lives at `packages/cli/scripts/schema.ts`. | It is build tooling, not part of the published module. |

## Order of work

```
1 Workspace, TypeScript, first test
├── 2 Lint and format gate
│   └── 4 Read and check acmelabs.json
│       ├── 5 Manifests and validators per host
│       ├── 6 Canonical file text and this repo's acmelabs.json
│       └── 7 The JSON schema for editors
└── 3 Changesets, as brain does
```

Task 4 waits for task 2 so that every line of module code is linted from its first commit. Tasks 5, 6 and 7 are independent of each other once task 4 is done.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| oxlint and oxfmt may load a TypeScript config only through Node, which breaks the Bun-only rule in CI (open question 4 in `spec/README.md`, UNVERIFIED) | Medium | Task 2 runs lint and format with Node removed from PATH, and writes the result to `docs/research/`. A failure goes to the `config-presets` spec, not this plan. |
| `@changesets/changelog-github` needs the GitHub repo and a token when it versions | Low | No version runs before `cli-release`. Task 3 checks `changeset status` only. |
| zod's JSON schema output changes between versions | Low | zod is pinned exactly, and task 7's check fails loudly on any drift. |

## Open questions

None block this plan. The spec's two open questions (Antigravity's `version` field; installing optional validators in CI) belong to `repo-checks` and `shared-workflows`.
