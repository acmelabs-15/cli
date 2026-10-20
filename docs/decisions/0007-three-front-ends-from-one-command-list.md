# One command list, three front-ends, and an MCP server

Decided by Peter on 2026-10-20 (spec interview, Q8a and QA2).

Each command is declared once, with its inputs, in the command list. Every front-end reads that list: the TUI that `acmelabs` opens with no command, CLI mode for a command called directly (inline `@clack/prompts`, themed to match the TUI), JSON mode (`--json`: no prompts, no styling, one JSON result), and the MCP server (`acmelabs mcp`). The agent guide's skill is generated from the same list. A command prompts only in a terminal; with no terminal, a missing input is an error that names its flag. Peter described the model as Claude Code's: a TUI by default, and the same work runnable without it.
