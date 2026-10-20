# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, after module `command-core` merged, by the Claude Code session that ran the spec interview and the first two builds.

## Where things stand

- **The spec:** the capability map of 16 modules is approved (`spec/README.md`). Every interview decision is recorded (`docs/design/spec-interview.md`, `docs/decisions/`).
- **Done and merged into main:** `repo-model` (PR #1, `082abe4`) and `command-core` (PR #2, `38888fa`). Each was built in `/brain:build auto` mode, reviewed on five axes, fixed, and re-checked (`docs/reviews/`). Their plans are in `tasks/done/`. `bun run check` is green on main: 178 tests.
- **No module is in progress.** `tasks/plan.md` and `tasks/todo.md` do not exist until the next module's plan.
- **The repo:** public at https://github.com/acmelabs-15/cli, main protected by "Protect main". Peter's standing permissions: commit at task and session ends, push after every commit, one branch per module merged through one PR; merging is asked.

## Red and notes

- **Open question 19 blocks `repo-checks`:** a parse error that quotes a linked `acmelabs.json` reaches JSON mode's lines. Settle it in the `repo-checks` spec, before a command that reads the config ships.
- **Open questions 21 and 22** (an environment allowlist for outside programs; output and time limits) wait for `github-ops`, by Peter's choice.
- **New repos and the two plugins:** this repo runs brain's version of a skill both plugins carry; awaken-the-slumberer (now "Last of the Colossi") runs agent-skills' version. The rule for new repos is open question 6, for the `scaffold` spec.
- **npm:** the local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA, in module `cli-release`.
- **Two brain fixes are owed** (open questions 16 and 17): brain's changesets `$schema`, and its helper-order wording.

## Waiting on Peter

Nothing blocks.

## Next steps

1. The other layer 1 specs, in build order (`spec/README.md`): `config-presets`, `github-ops`, `npm-ops`. `tui-kit` waits for its prototype (open question 3: the vendored `@clack/ui` on tty 0.9).
2. Each module: `/brain:spec` for its `spec/SPEC-<module-id>.md`, Peter's approval, `/brain:plan`, then the build on a branch named after the module.
