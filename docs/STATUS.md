# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, 00:55 PDT, by the Claude Code session that ran the spec interview.

## Where things stand

- **Phase: Spec** (`/brain:spec`), for the whole initiative.
- **Done:** `setup-brain` (local markdown tracker); the spec interview's decisions (`docs/design/spec-interview.md`); the capability map, approved by Peter on 2026-10-20 (`spec/README.md`); eleven decision records; the research notes; the glossary; `AGENTS.md`, the root `CLAUDE.md` and `.claude/settings.json`. Every interview question is settled, the test seams included.
- **Module specs:** `repo-model` approved by Peter on 2026-10-20 (`spec/SPEC-repo-model.md`). No other module spec is written. No code exists. The repo is public at https://github.com/acmelabs-15/cli, created and pushed on 2026-10-20 with Peter's approval, with brain's Actions setting and the "Protect main" ruleset. Each push is asked first.

## Red and notes

- Peter answered "both plugins" for new repos. This repo runs brain's version on a shared skill name; awaken-the-slumberer runs agent-skills' version. New repos' rule is open for the `scaffold` spec.
- The local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA; that comes in the `cli-release` module, not now.

## Waiting on Peter

Nothing now. Peter approved the first commit, and the two global rules (research in files; every question through ask-user-question) are in `~/CLAUDE.md` §1.

## Next steps

1. Build `repo-model`: `tasks/todo.md`, task 1 first. Peter approved the plan on 2026-10-20 (size right, edges right, no merge or split).
2. Then the other layer 1 specs in build order (`spec/README.md`): `command-core`, `config-presets`, `github-ops`, `npm-ops`. `tui-kit` waits for its prototype (open question 3).
3. Each module spec goes to Peter for approval, then `/brain:plan` for that module.
