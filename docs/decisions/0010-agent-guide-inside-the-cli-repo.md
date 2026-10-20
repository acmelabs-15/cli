# The agent-guide plugin lives inside the cli repo

Decided by Peter on 2026-10-20 (spec interview, QA7).

The plugin that hosts install for the agent guide (the skill, the MCP entry and the four hosts' manifests) lives in the cli repo, beside the two npm packages. The skill and a command change land in the same commit, so the skill cannot drift from the command list. The agent recommended a separate repo made by `acmelabs new`, which would also have proven `new` on a real plugin.

## Consequences

- The cli repo runs both release flows: npm publishes for `@acmelabs/cli` and `@acmelabs/config`, and the latest tag for the plugin.
- The done-when for `acmelabs new` needs its own acceptance run on a scratch repo, asked for before it is created.
