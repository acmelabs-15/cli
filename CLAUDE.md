@AGENTS.md

## Claude Code

The project rules above are shared with every coding agent. This section adds only what is specific to Claude Code.

### Workflow skills

Both plugins are enabled for this project in `.claude/settings.json` (ADR-0011).

**brain** (`brain@acmelabs`) drives every phase in the table under "Phases and gates", because the brief runs brain's lifecycle. Load each of these brain skills at its trigger:

| Trigger | Skill |
|---|---|
| A decision that is Peter's, in any phase | `brain:ask-user-question`, one question per call |
| A domain word that `CONTEXT.md` lacks or uses loosely | `brain:domain-modeling` |
| An edit to a skill, `AGENTS.md` or `CLAUDE.md` | `brain:writing-for-agents` |
| A design question that needs runnable code to settle | `brain:prototype` |
| A module's interface or seam | `brain:codebase-design` |
| A change to a GitHub Actions workflow | `brain:ci-cd-and-automation` |

**agent-skills** (`agent-skills@addy-agent-skills`) is enabled too. When both plugins carry a skill with the same name, run the brain version: brain's copy carries the glossary and one-question rules this repo follows.

Five brain skills start only from Peter's prompt. When one fits, ask him to run it: `/brain:setup-brain`, `/brain:wait-what`, `/brain:handoff`, `/brain:triage`, `/brain:wayfinder`.

### Sub-agents

A research sub-agent gets a target file in its prompt: a note under `docs/research/`, or a file in the session scratchpad for work in progress. It writes its findings there and replies with the path only. Read the file, not the reply.
