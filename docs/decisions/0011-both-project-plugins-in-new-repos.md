# New repos enable both agent-skills and brain

Decided by Peter on 2026-10-20 (spec interview, QA1).

Every repo that `acmelabs new` makes enables Addy Osmani's agent-skills plugin and the brain plugin at project scope, in `.claude/settings.json`, and its `AGENTS.md` and `CLAUDE.md` tell agents to use both. brain already vendors agent-skills' 25 skills and owns 8 of them under the same names, so every lifecycle skill loads twice; the agent recommended brain only. Peter chose both. awaken-the-slumberer runs the same pair and settles collisions in its `CLAUDE.md`: on a shared name, run the agent-skills version.

## Consequences

- Which version wins on a shared name in new ACMElabs repos is open for the `scaffold` spec. In this repo, the brief's lifecycle is brain's, so brain's version runs.
