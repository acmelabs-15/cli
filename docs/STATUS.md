# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, after the `github-ops` plan was approved, by the Claude Code session that wrote the spec and the plan.

## Where things stand

- **The spec:** the capability map of 16 modules is approved (`spec/README.md`). Every interview decision is recorded (`docs/design/spec-interview.md`, `docs/decisions/`).
- **Done and merged into main:** `repo-model` (PR #1, `082abe4`), `command-core` (PR #2, `38888fa`) and `config-presets` (PR #3, `7fcb916`). Their plans are in `tasks/done/`. `bun run check` is green on main: 213 tests.
- **In progress: `github-ops`, on branch `github-ops`.** The spec is approved (`spec/SPEC-github-ops.md`, draft `0601f9b`). The plan is approved: 13 tasks in three phases (`tasks/plan.md`, `tasks/todo.md`). Phase: Build. No task is done yet.
- **What the `github-ops` spec settled:** GitHub calls run through `gh api`, and push and clone through git with gh's credential helper (ADR-0014); each step reads before it writes and picks up a half-done run; outside programs keep the whole environment, and every program and request runs under limits of 5 minutes, 1 minute and 10 MB (ADR-0015, open questions 21 and 22 settled); the tests use the command seam and the World's own tests, and no test calls GitHub. Research notes 09 and 10 hold the facts.
- **The repo:** public at https://github.com/acmelabs-15/cli, main protected by "Protect main". Peter's standing permissions: commit at task and session ends, push after every commit, one branch per module merged through one PR; opening a PR and merging are asked.

## Red and notes

- **A flaky timing test in `repo-model`:** "reads a list of 10,000 distinct package paths in under 100 ms" took 132 ms once while other tests ran on the machine; quiet runs take 37 to 45 ms. It is not fixed; a wall-clock limit in a unit test fails under load.
- **This repo's root configs do not load under real Node** (an editor's oxc extension). Peter accepted this on 2026-10-20 (`spec/SPEC-config-presets.md`, "This repo on the presets"). Other repos import the built package, which loads under Node.
- **For `cli-release`:** open questions 23 (does a changesets changelog under `packages/` pass the format check?) and 24 (each package folder needs a `LICENSE`); the built JavaScript holds path comments with the install store's hash, so a byte-for-byte compare of release builds must build from one fixed folder.
- **Open question 19 blocks `repo-checks`:** a parse error that quotes a linked `acmelabs.json` reaches JSON mode's lines. Settle it in the `repo-checks` spec, before a command that reads the config ships.
- **For `shared-workflows`:** prove the World's process groups and limits on Linux in CI (open question 22), beside `run.bun` (open question 4).
- **For the `github-ops` build:** the timing right after a repo is created is UNVERIFIED (spec open question 1). A probe with a scratch repo would settle it; the gh login cannot delete a repo, so the probe is asked before it runs.
- **New repos and the two plugins:** the rule for which plugin's skill runs on a shared name is open question 6, for the `scaffold` spec.
- **npm:** the local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA, in module `cli-release`.

## Waiting on Peter

Nothing blocks. Opening the PR and merging it are asked at the module's last checkpoint.

## Next steps

1. `/brain:build` for `github-ops` (or `/brain:build auto`, which Peter's plan approval allows): task 1, a program runs in its own process group, under a time limit.
2. The other layer 1 spec: `npm-ops`. `tui-kit` waits for its prototype (open question 3: the vendored `@clack/ui` on tty 0.9).
