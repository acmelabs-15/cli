# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, after module `config-presets` merged, by the Claude Code session that wrote its spec and plan and ran its build.

## Where things stand

- **The spec:** the capability map of 16 modules is approved (`spec/README.md`). Every interview decision is recorded (`docs/design/spec-interview.md`, `docs/decisions/`).
- **Done and merged into main:** `repo-model` (PR #1, `082abe4`), `command-core` (PR #2, `38888fa`) and `config-presets` (PR #3, `7fcb916`). Each was built in `/brain:build auto` mode, reviewed on five axes, fixed, and re-checked (`docs/reviews/`). Their plans are in `tasks/done/`. `bun run check` is green on main: 213 tests.
- **`config-presets` added:** `@acmelabs/config` (the lint, format and TypeScript presets, each deviation with its reason, Ultracite's presets bundled per ADR-0013); the gate on Bun through `run.bun` in `bunfig.toml` (ADR-0012); this repo's root configs on the presets; the sample-repo test seam (`spec/README.md`, "Test seams").
- **No module is in progress.** `tasks/plan.md` and `tasks/todo.md` do not exist until the next module's plan.
- **The repo:** public at https://github.com/acmelabs-15/cli, main protected by "Protect main". Peter's standing permissions: commit at task and session ends, push after every commit, one branch per module merged through one PR; opening a PR and merging are asked.

## Red and notes

- **A flaky timing test in `repo-model`:** "reads a list of 10,000 distinct package paths in under 100 ms" took 132 ms once while other tests ran on the machine; quiet runs take 37 to 45 ms. It is not fixed; a wall-clock limit in a unit test fails under load.
- **This repo's root configs do not load under real Node** (an editor's oxc extension). Peter accepted this on 2026-10-20 (`spec/SPEC-config-presets.md`, "This repo on the presets"). Other repos import the built package, which loads under Node.
- **For `cli-release`:** open questions 23 (does a changesets changelog under `packages/` pass the format check?) and 24 (each package folder needs a `LICENSE`); the built JavaScript holds path comments with the install store's hash, so a byte-for-byte compare of release builds must build from one fixed folder.
- **Open question 19 blocks `repo-checks`:** a parse error that quotes a linked `acmelabs.json` reaches JSON mode's lines. Settle it in the `repo-checks` spec, before a command that reads the config ships.
- **Open questions 21 and 22** (an environment allowlist for outside programs; output and time limits) wait for `github-ops`, by Peter's choice.
- **New repos and the two plugins:** the rule for which plugin's skill runs on a shared name is open question 6, for the `scaffold` spec.
- **npm:** the local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA, in module `cli-release`.

## Waiting on Peter

Nothing blocks.

## Next steps

1. The other layer 1 specs, in build order (`spec/README.md`): `github-ops`, `npm-ops`. `tui-kit` waits for its prototype (open question 3: the vendored `@clack/ui` on tty 0.9).
2. Each module: `/brain:spec` for its `spec/SPEC-<module-id>.md`, Peter's approval, `/brain:plan`, then the build on a branch named after the module.
