# Tasks — repo-model

The task list for `tasks/plan.md`. Tick a task in the checklist when it meets its acceptance criteria and the Definition of Done (brain's `references/definition-of-done.md`: correctness and quality per task). Each task ends with `bun run check` green and one commit, its files staged by name.

## Checklist

Phase 1 Foundation

- [x] 1. Workspace, TypeScript, and the first test: the four host ids
- [x] 2. Lint and format gate
- [x] 3. Changesets, as brain does
- [x] Checkpoint: foundation

Phase 2 repo-model

- [x] 4. Read and check `acmelabs.json`
- [x] 5. Manifests and validators per host
- [x] 6. Canonical file text, and this repo's own `acmelabs.json`
- [x] 7. The JSON schema for editors
- [ ] 8. Review fixes: file reading, the package-path rule, one rule in both forms
- [ ] 9. Review fixes: names, doc lines, nits and the glossary term
- [ ] Checkpoint: repo-model complete

## Task 1: Workspace, TypeScript, and the first test: the four host ids

**Description:** Make the repo a Bun workspace with one package, `@acmelabs/cli`, and give it a gate that runs TypeScript and the tests. The first test pins the four host ids in host-table order, the smallest real piece of `repo-model`.

**Acceptance criteria:**
- [x] The root `package.json` is private, declares the workspace `packages/*`, and has the scripts `typecheck`, `test` and `check`.
- [x] `packages/cli/package.json` names `@acmelabs/cli`, version 0.0.0, `"private": true`, `"type": "module"`, `"license": "MIT"`.
- [x] `hostIds` in `packages/cli/src/repo/hosts.ts` is `claude-code`, `codex`, `gemini-cli`, `antigravity-cli`, in that order, and `HostId` is its type.
- [x] `packages/cli/README.md` says what the package is, that it is not yet published, and points at the repo's README. (Added by Peter on 2026-10-20 after plan approval.)

**Verification:**
- [x] The test fails before `hosts.ts` exists, then passes: `bun test packages/cli/src/repo`
- [x] `bun run check` is green (typecheck and tests).
- [x] `bun install --frozen-lockfile` succeeds on the committed `bun.lock`.

**Dependencies:** None

**Files likely touched:** `package.json`, `tsconfig.json`, `.gitignore`, `bun.lock`, `packages/cli/package.json`, `packages/cli/README.md`, `packages/cli/src/repo/hosts.ts`, `packages/cli/src/repo/__tests__/hosts.test.ts`

**Estimated scope:** Medium (config files are one-liners; two code files)

## Task 2: Lint and format gate

**Description:** Add oxlint and oxfmt with brain's DEC-001 settings (Ultracite's presets, 100 columns, trailing commas everywhere, the four rule relaxations with their reasons), and add both to the gate. Find out whether they run with no Node on PATH.

**Acceptance criteria:**
- [x] `oxlint.config.ts` and `oxfmt.config.ts` carry brain's settings, and each deviation names its reason.
- [x] `bun run check` runs typecheck, lint, format check and tests, in that order.
- [x] The result of running lint and format with Node removed from PATH is written to `docs/research/`, as a new note with a row in the index.

**Verification:**
- [x] `bun run lint` and `bun run format:check` pass on task 1's code.
- [x] A deliberate lint error makes `bun run check` fail, and removing it makes it pass again.
- [x] `env -i PATH="$HOME/.bun/bin:/usr/bin:/bin" bun run lint` (and `format:check`) is run, and its outcome is recorded either way.

**Dependencies:** 1

**Files likely touched:** `oxlint.config.ts`, `oxfmt.config.ts`, `package.json`, `bun.lock`, `docs/research/07-oxc-without-node.md`, `docs/research/README.md`

**Estimated scope:** Small

## Task 3: Changesets, as brain does

**Description:** Set up changesets the way brain does, adapted to a workspace with two release flows: `.changeset/config.json` with `@changesets/changelog-github` for acmelabs-15/cli, and `.changeset/README.md` explaining when a change gets a changeset and what each release flow does.

**Acceptance criteria:**
- [x] `.changeset/config.json` matches brain's, with the repo set to `acmelabs-15/cli`.
- [x] `.changeset/README.md` explains the library flow (npm publish) and the plugin flow (the latest tag), in the glossary's words.
- [x] The root scripts `changeset` and `version` exist; `version` runs `changeset version`. The version sync step joins it when `repo-checks` lands.

**Verification:**
- [x] `bun run changeset status` exits 0.
- [x] `bun run check` is green.

**Dependencies:** 1

**Files likely touched:** `.changeset/config.json`, `.changeset/README.md`, `package.json`, `bun.lock`

**Estimated scope:** Small

## Checkpoint: foundation

- [x] `bun run check` is green on a clean clone: `bun install --frozen-lockfile`, then `bun run check`.
- [x] Tasks 1–3 are committed, one commit each.

## Task 4: Read and check `acmelabs.json`

**Description:** A command can read a repo's config and get either a typed `RepoConfig` or a `RepoConfigError` that names the file and each bad field. The zod schema enforces the spec's rules: at least one kind, known and distinct hosts, distinct packages, no unknown field.

**Acceptance criteria:**
- [x] `readRepoConfig(root)` returns a typed config for a plugin-only, a library-only and a both-kinds `acmelabs.json`.
- [x] It throws `RepoConfigError`, naming the file and the field, for: no file; invalid JSON; neither kind; an empty host list; an unknown host (the message lists the known hosts); a repeated host; an empty package list; a repeated package; an unknown field.
- [x] A changeset records the new `acmelabs.json` repo config.

**Verification:**
- [x] The tests fail before `config.ts` exists, then pass: `bun test packages/cli/src/repo`
- [x] `bun run check` is green.

**Dependencies:** 1, 2

**Files likely touched:** `packages/cli/src/repo/config.ts`, `packages/cli/src/repo/__tests__/config.test.ts`, `packages/cli/package.json` (zod), `bun.lock`, `.changeset/<name>.md`

**Estimated scope:** Medium

## Task 5: Manifests and validators per host

**Description:** The host table gives each host's manifests (path and version field) and validators (command, and whether it is required), as `spec/SPEC-repo-model.md` lists them. `manifestsFor` and `validatorsFor` give a repo's list in host-table order.

**Acceptance criteria:**
- [x] `manifestsFor` gives jev-gate's two manifests for `claude-code` alone.
- [x] For all four hosts, its versioned manifests are brain's five, in brain's order, and Antigravity's `plugin.json` has no version field.
- [x] `validatorsFor` keeps host-table order and the table's `required` values; a library-only config has no manifests and no validators.

**Verification:**
- [x] The new tests fail first, then pass: `bun test packages/cli/src/repo`
- [x] `bun run check` is green.

**Dependencies:** 4

**Files likely touched:** `packages/cli/src/repo/hosts.ts`, `packages/cli/src/repo/__tests__/hosts.test.ts`

**Estimated scope:** Small

## Task 6: Canonical file text, and this repo's own `acmelabs.json`

**Description:** `formatRepoConfig` writes the one canonical text of an `acmelabs.json`, so `scaffold` and `jev-gate-migration` never churn the file. This repo gets its own `acmelabs.json`, both kinds, written with it.

**Acceptance criteria:**
- [x] `formatRepoConfig` output reads back equal, and a second format is byte-identical: two-space JSON, `$schema` first, a final newline.
- [x] The root `acmelabs.json` declares the plugin (all four hosts) and the library (`packages/cli`, `packages/config`) and equals `formatRepoConfig`'s text.
- [x] A test reads this repo's own `acmelabs.json` back with `readRepoConfig`.
- [x] A package path that is absolute, leaves the repo (`..`) or is empty fails with an issue that names the field, for example `library.packages[0]: "/abs/x" is not a relative path inside the repo`. (from task 4's report)
- [x] Package paths compare in normal form, so `./packages/cli` and `packages/cli` count as a repeat, and `readRepoConfig` returns the normal form: no leading `./`, no trailing `/`. (from task 4's report)
- [x] A missing `hosts` or `packages` field fails in the house wording, for example `plugin.hosts: the field is missing; name at least one host`. (from task 4's report)

**Verification:**
- [x] The new tests fail first, then pass: `bun test packages/cli/src/repo`
- [x] `bun run check` is green.

**Dependencies:** 4

**Files likely touched:** `packages/cli/src/repo/config.ts`, `packages/cli/src/repo/__tests__/config.test.ts`, `acmelabs.json`

**Estimated scope:** Small

## Task 7: The JSON schema for editors

**Description:** `bun run schema` writes `packages/cli/schema/acmelabs.schema.json` from the zod schema, and `bun run schema --check` fails when the file is not current. The check joins `bun run check`, so the editor check and the command check never disagree.

**Acceptance criteria:**
- [x] The shipped schema file equals `z.toJSONSchema(repoConfigSchema)` with the overrides for the refinements.
- [x] `bun run schema --check` exits 1 after a schema change with no regenerated file, and names the file.
- [x] `bun run check` includes the schema check.

**Verification:**
- [x] The test for the check mode fails first, then passes: `bun test packages/cli`
- [x] `bun run check` is green.
- [x] Manual check: in an editor, a wrong host id in this repo's `acmelabs.json` is flagged. (Checked with VS Code 1.136.1's own JSON language server, run under Bun, on a copy of the file.)

**Dependencies:** 4

**Files likely touched:** `packages/cli/scripts/schema.ts`, `packages/cli/scripts/__tests__/schema.test.ts`, `packages/cli/schema/acmelabs.schema.json`, `package.json`, `.changeset/<name>.md`

**Estimated scope:** Medium

## Task 8: Review fixes: file reading, the package-path rule, one rule in both forms

**Description:** Fix the review's findings 1 to 4 (`docs/reviews/2026-10-20-repo-model.md`), which Peter chose on 2026-10-20: groups 1 and 2, and the size cap from group 3. Every way of failing to read `acmelabs.json` becomes a `RepoConfigError` that names the file. The package-path rule gets stricter, and its two forms (the command's and the editor schema's) are proven to agree.

**Acceptance criteria:**
- [ ] A folder named `acmelabs.json`, an unreadable file, and a file over 1 MiB each fail with a `RepoConfigError` that names the file and says what is wrong (findings 1 and 4).
- [ ] A package path with a backslash, a NUL byte, a drive prefix such as `C:`, or only blanks fails in the command and in the editor schema (finding 3).
- [ ] One test runs the command's rule and the editor schema's pattern over one shared list of sample paths and expects the same verdict for each; the pattern has one comment line per lookahead; `editorSchema` throws when an override key matches no node (finding 2).

**Verification:**
- [ ] Each new test fails first, then passes: `bun test packages/cli`
- [ ] `bun run check` is green, the schema check included.

**Dependencies:** 7

**Files likely touched:** `packages/cli/src/repo/config.ts`, `packages/cli/src/repo/__tests__/config.test.ts`, `packages/cli/scripts/schema.ts`, `packages/cli/scripts/__tests__/schema.test.ts`, `packages/cli/schema/acmelabs.schema.json`

**Estimated scope:** Medium

## Task 9: Review fixes: names, doc lines, nits and the glossary term

**Description:** Fix the review's findings 6 to 15, the rest of group 3, which Peter chose on 2026-10-20. No behaviour changes except the house wording for a non-object file.

**Acceptance criteria:**
- [ ] Findings 6 to 11 and 13 to 15 of the review are fixed as the review says; a file that holds a non-object, such as `[]`, fails with the house wording, with a test.
- [ ] The spec's host table names each host (finding 12), and `CONTEXT.md` has an entry for the editor schema, used in the code's doc comments (finding 14).
- [ ] The review file marks each fixed finding as fixed.

**Verification:**
- [ ] `bun run check` is green.

**Dependencies:** 8

**Files likely touched:** `packages/cli/src/repo/config.ts`, `packages/cli/src/repo/hosts.ts`, `packages/cli/scripts/schema.ts`, the three test files, `oxlint.config.ts`, `spec/SPEC-repo-model.md`, `CONTEXT.md`, `docs/reviews/2026-10-20-repo-model.md`

**Estimated scope:** Medium (many files, each a small edit)

## Checkpoint: repo-model complete

- [ ] Every success criterion in `spec/SPEC-repo-model.md` passes.
- [ ] The Definition of Done holds for the module: integration and documentation included.
- [ ] `/brain:review` on the module's commits, then Peter reviews before the next module starts.
