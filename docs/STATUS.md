# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, 00:55 PDT, by the Claude Code session that ran the spec interview.

## Where things stand

- **Phase: Spec** (`/brain:spec`), for the whole initiative.
- **Done:** `setup-brain` (local markdown tracker); the spec interview's decisions (`docs/design/spec-interview.md`); the capability map, approved by Peter on 2026-10-20 (`spec/README.md`); eleven decision records; the research notes; the glossary; `AGENTS.md`, the root `CLAUDE.md` and `.claude/settings.json`. Every interview question is settled, the test seams included.
- **No module spec is written yet.** No code exists. Nothing is committed: the repo has no commits and no remote.

## Red and notes

- Peter answered "both plugins" for new repos. This repo runs brain's version on a shared skill name; awaken-the-slumberer runs agent-skills' version. New repos' rule is open for the `scaffold` spec.
- The local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA; that comes in the `cli-release` module, not now.

## Waiting on Peter

1. **First commit:** approval to commit these records as the repo's first commit.

## Next steps

1. Write the layer 1 module specs in build order (`spec/README.md`), starting with `repo-model` and `command-core`. `tui-kit` waits for its prototype (open question 3 in `spec/README.md`).
2. Each module spec goes to Peter for approval, then `/brain:plan` for that module.
