# ACMElabs CLI

`acmelabs` is the one tool for ACMElabs repos. It makes a new repo start in the ACMElabs shape and keeps every repo in that shape afterwards. This repo is acmelabs-15/cli on GitHub, public, with main protected by the "Protect main" ruleset. It holds the CLI (`@acmelabs/cli`), the presets (`@acmelabs/config`) and the agent-guide plugin. Peter is the owner, and the decisions that are his go to him.

This file holds the project rules for every coding agent. Tool-specific setup is in the last section.

## Session start

Run these steps in order at the start of every session, before any other work. Each step ends on its check.

1. **Read.** `docs/STATUS.md` (the handoff note), `CONTEXT.md`, `spec/README.md`, the spec of the module in progress (`spec/SPEC-<module-id>.md`), and `tasks/todo.md` once it exists. Done when each file is read to its last line.
2. **Sync.** Run `git status --short`. Once a remote exists, run `git fetch` and `git status -sb` too. Done when the tree is clean and `main` matches `origin/main`. When the tree holds changes this session did not make, report them to Peter and leave those files as they are.
3. **Baseline.** Once code exists, run `bun run check`. Done when every check's result is known.
4. **Report.** Send Peter a status of five lines or fewer: the phase, the last completed task, the next task, anything red from steps 2 and 3, and what waits on him. Then start the next task from `docs/STATUS.md` or `tasks/todo.md`, unless a gate or one of Peter's decisions comes first.

Read on demand:

- **Before changing an area:** the decision records in `docs/decisions/` that cover it. A change that reverses one gets a new record that supersedes the old one.
- **For the reason behind a requirement:** `docs/design/kickoff-brief.md` (the brief and Peter's dated changes) and `docs/design/spec-interview.md` (every interview answer). Both are history; where they differ from `spec/` or `docs/decisions/`, those win.
- **For a fact about a tool or service** (Bun, npm, GitHub Actions, the hosts, tty, clack, the router): `docs/research/README.md`, then the note it points to.

## Session end

Run these steps at the end of every session and after each completed task:

1. Tick the finished tasks in `tasks/todo.md`.
2. Rewrite `docs/STATUS.md`: date, phase, last completed task, next task, anything red, and what waits on Peter. Done when a new session can continue from it alone.
3. Commit and push, and tell Peter the commit's hash and subject. Peter gave standing permission on 2026-10-20 to commit at each task end and session end, and to push after every commit ("push frequently"). Done when `git status` is clean and the branch matches its remote.

## Phases and gates

The work follows brain's lifecycle, one module at a time, in the build order of `spec/README.md`.

| Phase | Command | Done when |
|---|---|---|
| Spec | `/brain:spec` | The module's `spec/SPEC-<module-id>.md` is written. **STOP** for Peter's approval. |
| Plan | `/brain:plan` | `tasks/plan.md` and `tasks/todo.md` cover the module. **STOP** for Peter's approval. |
| Build | `/brain:build`, or `/brain:build auto` once Peter approves the plan | Every task is ticked and `bun run check` is green. |
| Test | `/brain:test` | The module's success criteria pass at the test seams in its spec. |
| Review | `/brain:review` | Before each merge. |
| Ship | `/brain:ship` | Before each release. |

At a STOP, the next phase starts only after Peter approves in the conversation. When a plan is bigger than one session, Peter runs `wayfinder` to split it.

## Where things live

| What | Where |
|---|---|
| The capability map and one spec per module | `spec/` |
| The plan and the task list of the module in progress; done plans by module | `tasks/plan.md`, `tasks/todo.md`; `tasks/done/<module-id>/` |
| The handoff note | `docs/STATUS.md` |
| The brief and the interview record | `docs/design/` |
| Decision records | `docs/decisions/NNNN-short-title.md` |
| Research notes and their index | `docs/research/` |
| The glossary | `CONTEXT.md` |
| How brain's skills read this repo; the issue tracker | `docs/agents/` |
| Issues | `.scratch/<feature>/issues/` (local markdown) |
| Tests | `__tests__/` beside the file under test |

## Rules for every change

- **Bun 1.4.0 only.** No Node runtime ships. CI may run the npm CLI for the publish step only (ADR-0006).
- **Tests first.** A failing test, then the code. Tests sit in `__tests__/` beside the file under test, named `<file>.test.ts`, with `bun:test`.
- **The gate.** `bun run check` (typecheck, oxlint, oxfmt check, tests, version check) is green before every commit.
- **Commits and branches.** One commit per task. Stage the task's files by name. Records and docs go straight to `main`. A module's code, and the records that change with its build (its spec, `tasks/`, `docs/STATUS.md`), go on a branch named after its module id, pushed after every commit, and merges into `main` through one PR with a merge commit at the module's checkpoint, after Peter's review. Merging is asked.
- **Outward-facing steps.** Push, PR, merge, release, repo creation, visibility, npm publish and npm org creation are asked once, then run as small separate shell commands.
- **Verify or say unverified.** Check Claude Code, GitHub Actions and npm behaviour against their current docs; all three change fast.
- **Words.** Domain words come from `CONTEXT.md`. A concept the glossary lacks goes through the domain-modeling skill.
- **Questions to Peter.** Every question to Peter, a decision or a permission, goes through the ask-user-question skill, one question per call, with the facts and a recommendation inside the question. A choice is Peter's when two paths are defensible, the choice changes what gets built, and reading more would not settle it.
- **Decisions.** A decision that is hard to reverse, surprising without context and the result of a real trade-off gets a short record in `docs/decisions/`.
- **Research lands in files.** A research agent writes its findings to a Markdown file, and its parent reads that file, not the agent's reply; replies between agents often fail. An agent that delegates names each sub-agent's target file in its prompt. A finished note goes in `docs/research/` with a row in its `README.md` index.
- **Commands.** A new command is one file and one line in the command list, with its own tests. `acmelabs --help` lists every command.

## Tool setup

| Tool | Rules file | Plugins |
|---|---|---|
| Claude Code | `CLAUDE.md` (imports this file) | agent-skills and brain, enabled in `.claude/settings.json` |
| Codex | this file | agent-skills and brain, enabled in Codex's user config (`~/.codex/config.toml`). The plain-talk block is in `~/.codex/AGENTS.md`. |
| Gemini CLI | none yet: Gemini CLI reads `GEMINI.md` by default, and this repo has none | brain, installed as a user extension |
