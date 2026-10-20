# Two repo kinds and four hosts, declared in one repo config

Decided by Peter on 2026-10-20 (spec interview, Q3 and Q4).

The CLI serves plugin repos and library repos, and it knows all four hosts: Claude Code, Codex, Gemini CLI and Antigravity CLI. Each repo declares its repo kind and its hosts once, in its repo config, and every command and shared workflow reads that one declaration. `acmelabs new` asks for both; Claude Code is the default host. The agent recommended plugins only for this pass, because design-system already has its own library flow; Peter chose both kinds, so the shared release workflow carries an npm publish path from the start. Supporting all four hosts now means brain can later move onto the CLI with no CLI change.

## Consequences

- Codex has no validator, so a Codex manifest is checked only by its shape.
- brain does not run `gemini extensions validate` today. `acmelabs validate` can; adding it to brain's run during brain's migration is a change in checks, not in what the plugin does.
