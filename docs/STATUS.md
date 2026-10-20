# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, after the `config-presets` build, review and re-check, by the Claude Code session that wrote its spec and plan and ran its build.

## Where things stand

- **The spec:** the capability map of 16 modules is approved (`spec/README.md`). Every interview decision is recorded (`docs/design/spec-interview.md`, `docs/decisions/`).
- **Done and merged into main:** `repo-model` (PR #1, `082abe4`) and `command-core` (PR #2, `38888fa`). Their plans are in `tasks/done/`.
- **`config-presets` is built, reviewed and re-checked, on branch `config-presets`; its PR is not open yet.** All 13 tasks are done (`tasks/todo.md`), the five-axis review and its re-check are in `docs/reviews/2026-10-20-config-presets.md` (verdict after the fixes: approve), and `bun run check` is green with 213 tests: normally, with a failing `node` first on PATH, and on a clean clone. The module made `@acmelabs/config` (three presets, each deviation with its reason, Ultracite's presets bundled per ADR-0013), put the gate on Bun (ADR-0012), moved this repo's root configs onto the presets, and made `formatRepoConfig` write oxfmt's layout.
- **`main` holds** this module's spec and records up to `c915de8`; the branch holds the code, `tasks/`, the review and this note.
- **The repo:** public at https://github.com/acmelabs-15/cli, main protected by "Protect main". Peter's standing permissions: commit at task and session ends, push after every commit, one branch per module merged through one PR; opening the PR and merging are asked.

## Red and notes

- **A flaky timing test in `repo-model`:** "reads a list of 10,000 distinct package paths in under 100 ms" took 132 ms once while other tests ran on the machine; quiet runs take 37 to 45 ms. It is not fixed; a wall-clock limit in a unit test fails under load.
- **This repo's root configs do not load under real Node** (an editor's oxc extension). Peter accepted this on 2026-10-20 (spec, "This repo on the presets"). Other repos import the built package, which loads under Node.
- **For `cli-release`:** open questions 23 (does a changesets changelog under `packages/` pass the format check?) and 24 (each package folder needs a `LICENSE`); the built JavaScript holds path comments with the install store's hash, so a byte-for-byte compare of release builds must build from one fixed folder.
- **Open question 19 blocks `repo-checks`:** a parse error that quotes a linked `acmelabs.json` reaches JSON mode's lines. Settle it in the `repo-checks` spec, before a command that reads the config ships.
- **Open questions 21 and 22** (an environment allowlist for outside programs; output and time limits) wait for `github-ops`, by Peter's choice.
- **New repos and the two plugins:** the rule for which plugin's skill runs on a shared name is open question 6, for the `scaffold` spec.
- **npm:** the local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA, in module `cli-release`.

## Waiting on Peter

- Opening the `config-presets` PR into `main`, then his review and the merge (merge commit). Both are asked.

## Next steps

1. Open the PR for `config-presets`, after Peter's yes; after his review and his yes, merge it with a merge commit. Then move `tasks/plan.md` and `tasks/todo.md` to `tasks/done/config-presets/`, and mark the module done in `spec/README.md`.
2. The other layer 1 specs, in build order (`spec/README.md`): `github-ops`, `npm-ops`. `tui-kit` waits for its prototype (open question 3: the vendored `@clack/ui` on tty 0.9).
