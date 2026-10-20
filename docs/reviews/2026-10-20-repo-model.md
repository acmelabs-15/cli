# Review: the repo-model module

The final-checkpoint review of module `repo-model` (`/brain:review`, the five-axis review of `code-review-and-quality`), run on 2026-10-20 before the module's PR into `main`.

**Verdict: request changes.** The approach is sound and every success criterion in the spec passes. Two Required findings stand.

## Context

| Item | Value |
|---|---|
| Fixed point | merge-base `4a6d238` (= `main`); diff `git diff 4a6d238...HEAD`; 14 commits, 29 files, about 1,750 added lines (about 1,000 of them tests and `bun.lock`) |
| Spec | `spec/SPEC-repo-model.md`, plus Peter's decisions in `docs/design/spec-interview.md` and `tasks/todo.md` |
| Standards | `AGENTS.md`, `CLAUDE.md`, `spec/README.md` ("Rules for every module"), the spec's "Code style", `oxlint.config.ts`, `oxfmt.config.ts`, `CONTEXT.md` |
| Axes | correctness, readability, architecture, security, performance: five parallel sub-agents on Sonnet, a different model from the one that wrote the code; plus the orchestrator's own test review |

## Verification story

- `bun run check` is green: typecheck, lint, format check, schema check, 51 tests. Re-run by the orchestrator after every task.
- The gate is green on a clean clone of the branch, and with no Node on PATH (`docs/research/07-oxc-without-node.md`).
- The editor schema was checked with VS Code's own JSON language server (task 7).
- One reviewer claim was checked and dropped: the repeat check does compare package paths in normal form (a direct run flags `./packages/cli/` and `packages/./cli` as repeats of `packages/cli`).

## Findings, ranked by leverage

### Required

1. **Read errors other than "missing" are not wrapped.** _Fixed in `316c209` (task 8)._ `[hard: spec/SPEC-repo-model.md, Boundaries: "A missing or invalid file is an error that names the file"]` (correctness)
   `packages/cli/src/repo/config.ts:103-119`, `readJson`. A directory named `acmelabs.json` reports "the file does not exist", and an unreadable file throws a raw error, not a `RepoConfigError`.
   Fix: catch the failure of `handle.text()` and wrap it in a `RepoConfigError` that names the file and the reason; test a directory and an unreadable file.

2. **One path rule, written twice, kept in step only by hand.** _Fixed in `316c209` (task 8)._ `[judgement]` (readability, architecture)
   `packages/cli/src/repo/config.ts:32-34` (`isRepoRelative`) and `packages/cli/scripts/schema.ts:38` (the editor `pattern`). The overrides at `schema.ts:25-42` are keyed by JSON-path strings, so a renamed field drops its override with no error.
   Fix: a parity test that runs both rules over one shared list of sample paths and expects the same verdict; one comment line per lookahead in the pattern; `editorSchema` throws when an override key matches no node.

### Optional

3. **The package path rule is loose for Windows-style and blank paths.** _Fixed in `316c209` (task 8)._ `[judgement]` (correctness, security)
   `config.ts:32-34` and `schema.ts:38` both accept `a\..\..\x`, a NUL byte, `C:/x` and a blank `" "`. No real package path holds these; on Windows the backslash form leaves the repo.
   Fix: reject backslash, NUL, a drive prefix and a blank path in both forms, with tests. This changes what `acmelabs.json` accepts.

4. **No size cap on `acmelabs.json`.** _Fixed in `316c209` (task 8)._ `[judgement]` (security)
   `config.ts:110`, `handle.text()` reads the whole file, so a hostile repo can make the CLI hang on a huge file.
   Fix: check `handle.size` against a cap (1 MiB) before reading; it pairs with finding 1.

5. **`formatRepoConfig` hand-writes oxfmt's layout.** _Deferred: open question 18 in `spec/README.md`._ `[judgement]` (architecture, correctness)
   `config.ts:143-158`. A `library` line over 100 columns is rewrapped by oxfmt. Already open question 18 in `spec/README.md`, for `scaffold` or `config-presets`.
   Fix: settle question 18 there; no change in this module.

6. **The schema script imports the root format config.** _Fixed in `a65ff19` (task 9)._ `[judgement]` (architecture)
   `packages/cli/scripts/schema.ts:12`, `import formatConfig from "../../../oxfmt.config"`. The import must change when `config-presets` moves the config into `@acmelabs/config`.
   Fix: a one-line comment that names that move.

7. **Small readability changes.** _Fixed in `a65ff19` (task 9)._ `[judgement]` (readability)
   - `config.ts:103`, `readJson` hides its missing-file error: rename it `readJsonFile`, or fold it into finding 1's fix.
   - `hosts.ts:16-20`, the two `Omit<…, "host">` types: name them `ManifestEntry` and `ValidatorEntry`.
   - `hosts.ts:13`, `required`: say in its doc line that it means "a missing tool fails the check".
   - No test feeds a non-object such as `[]` to `readRepoConfig`; it gets zod's default text, not the house wording.

### Nit

8. `config.ts:139`, `const { $schema: _schema, ...config }` names a variable only to drop it. _Fixed in `a65ff19` (task 9)._ `[judgement]` (readability)
9. `config.ts:30` and `oxlint.config.ts:14`, "(Peter, 2026-10-20)" in code comments is provenance, which belongs in an ADR or the interview record; keep the reason, drop the tag. _Fixed in `a65ff19` (task 9)._ `[judgement]` (readability)
10. `config.ts:14`, "One problem in a repo config" for the type `RepoConfigIssue`: say "issue". _Fixed in `a65ff19` (task 9)._ `[judgement]` (readability)
11. `hosts.ts:3, 22, 58, 64, 71`, "in host-table order" is said five times; say it once on `hostIds`. _Fixed in `a65ff19` (task 9)._ `[judgement]` (readability)
12. `hosts.ts:24-55`, `Host.name` is not in the spec's host table. _Fixed in `a65ff19` (task 9)._ It is scope creep, but `scaffold` will need the names for its host prompt. Fix: add the names to the spec's table. `[judgement]` (correctness)
13. `config.test.ts`, the fixture named `package-outside-repo` now also covers `..` inside the repo. _Fixed in `a65ff19` (task 9)._ `[judgement]` (orchestrator)
14. The words "editor schema", "JSON schema for editors" and "schema file" name one thing, and `CONTEXT.md` has no entry for it. _Fixed in `a65ff19` (task 9)._ A glossary gap, for the domain-modeling skill. `[judgement]` (readability)
15. `config.ts:55`, the repeat check is O(n²) through `indexOf`: 1,000 packages take 3 ms and 10,000 take 214 ms. _Fixed in `a65ff19` (task 9)._ Real lists hold 1 to 20 items. `[judgement]` (performance)

### FYI

16. `bun audit` reports a high advisory in a dev-only chain: `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm), through `ultracite > … > micromatch`. It never ships; the only runtime dependency is `zod`. Audit again before the first publish (`cli-release`). (security)
17. `config.ts` and `hosts.ts` import each other, type-only one way, so there is no runtime cycle. The spec's interface requires it. (architecture, readability)
18. `config.ts` changes for four reasons (rules, read, error, writer); the spec's "Project structure" fixes that layout. Split it only if it grows. (architecture)
19. The exports beyond the spec's interface (`RepoConfigIssue`, `Host`, `hostIds`, the schema script's functions) are used by the tests and by each other. The spec could list them. (correctness)
20. `bun run check` takes about 1 s, `tsc` about 70% of it. (performance)

## Checked and clean

- Every success criterion in the spec is met and tested, and Peter's added rules are implemented, not scope creep. (correctness)
- Untrusted input: the strict schema rejects unknown keys and `__proto__`; host ids come from a closed list; validator commands come from the static host table, never from the file; error text escapes values through `JSON.stringify`; the editor pattern has no ReDoS risk. (security)
- No `any`, no casts, no silent fallbacks; `src/` uses only `zod`, `node:path` and `Bun.file`, ready for the built-JS publish. (architecture)
- Tests check behaviour, cover each error case the spec lists, and use real files in a temp folder, as brain's tests do. (orchestrator)

## Re-check after tasks 8 and 9

Run on 2026-10-20 by the orchestrator, after `316c209` (task 8) and `a65ff19` (task 9). `bun run check` is green with 64 tests. VS Code's JSON language server flags the four new path cases (backslash, drive prefix, blank, NUL) against the shipped editor schema; the only gap left is the accepted one, a repeat in another spelling.

Both Required findings are resolved: every read failure is a `RepoConfigError` that names the file (`checkFile` and `readJsonFile` in `config.ts`), and a parity test plus the override guard keep the two forms of the path rule in step.

One new finding:

21. **Optional:** `acmelabs.json` may be a link to a file outside the repo, and a parse error can quote a fragment of that file. `[judgement]` (orchestrator, re-check)
    `packages/cli/src/repo/config.ts`, `checkFile` uses `stat`, which follows links. On Peter's machine this is harmless. In CI it matters only if a shared workflow runs the CLI on an untrusted pull request, where the link could point at a file that holds secrets.
    Fix: decide with the CI design. Either reject a link whose target leaves the repo (`lstat`, then `realpath` inside the repo root), or leave the file's content out of the parse error. Recorded as open question 19 in `spec/README.md`, for `shared-workflows` and `repo-checks`.

**Verdict after the re-check: approve.** The open findings are Optional, Nit or FYI, and each is fixed, deferred to a named module, or recorded.
