# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, after module `repo-model` merged, by the Claude Code session that ran the spec interview and the first build.

## Where things stand

- **The spec:** the capability map of 16 modules is approved (`spec/README.md`). Every interview decision is recorded (`docs/design/spec-interview.md`, `docs/decisions/`).
- **Module `repo-model`: done.** Built in `/brain:build auto` mode (9 tasks), reviewed on five axes (`docs/reviews/2026-10-20-repo-model.md`: approve after the re-check), and merged into main in PR #1 (`082abe4`). Its plan is in `tasks/done/repo-model/`. `bun run check` is green on main: 64 tests.
- **No module is in progress.** `tasks/plan.md` and `tasks/todo.md` do not exist until the next module's plan.
- **The repo:** public at https://github.com/acmelabs-15/cli, main protected by "Protect main". Peter's standing permissions: commit at task and session ends, push after every commit, one branch per module merged through one PR; merging is asked.

## Red and notes

- **New repos and the two plugins:** this repo runs brain's version of a skill both plugins carry; awaken-the-slumberer (now "Last of the Colossi") runs agent-skills' version. The rule for new repos is open question 6, for the `scaffold` spec.
- **npm:** the local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA, in module `cli-release`.
- **Open questions 15 to 19** in `spec/README.md` came out of the `repo-model` build; each names the module that settles it. Two need a brain PR: brain's changesets `$schema` (16) and its helper-order wording (17).

## Waiting on Peter

Nothing blocks. Peter chose to merge PR #1 before his own review; a look at it on GitHub is still welcome.

## Next steps

1. Build `command-core` on branch `command-core`, in `/brain:build auto` mode (Peter's choice, 2026-10-20). Plan approved (`tasks/plan.md`). Done: tasks 1–2. Next: task 3, input errors named by flag and positional. Then the other layer 1 specs: `config-presets`, `github-ops`, `npm-ops`. `tui-kit` waits for its prototype (open question 3: the vendored `@clack/ui` on tty 0.9).
2. Each module: `/brain:spec` for its `spec/SPEC-<module-id>.md`, Peter's approval, `/brain:plan`, then the build on a branch named after the module.
