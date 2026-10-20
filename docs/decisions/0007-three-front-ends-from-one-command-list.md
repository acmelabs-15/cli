# One command list, three front-ends, and an MCP server

Decided by Peter on 2026-10-20 (spec interview, Q8a and QA2).

Each command is declared once, with its inputs, in the command list. Every front-end reads that list: the TUI that `acmelabs` opens with no command, CLI mode for a command called directly (inline `@clack/prompts`, themed to match the TUI), JSON mode (`--json`: no prompts, no styling; JSON lines of progress, then one result line), and the MCP server (`acmelabs mcp`). The agent guide's skill is generated from the same list. A command prompts only in a terminal; with no terminal, a missing input is an error that names its flag. Peter described the model as Claude Code's: a TUI by default, and the same work runnable without it.

## JSON mode and exit codes (Peter, 2026-10-20, module `command-core`)

- **JSON mode always shows progress.** It prints one JSON line per progress update while the command runs, then the final answer as the last line, typed `result`, as Claude Code's `stream-json` format does. Progress is useful feedback, and a viewer such as a Claude Code mod can show it live. A script that wants only the answer reads the last line.
- **One exit code per failure mode** that changes what the caller does next, as the CLI Guidelines ("map the non-zero exit codes to the most important failure modes") and the GitHub CLI do: 0 done; 1 the command ran and found a problem; 2 bad input or a bad `acmelabs.json`; 3 an outside tool or service failed; 4 a login is needed (as in gh); 130 cancelled by the user (the shell's code for Ctrl+C); 70 a bug inside acmelabs itself (BSD's `EX_SOFTWARE`), added with the `command-core` spec so a bug never looks like a problem in the repo. The agent first recommended 0/1/2 to match brain; Peter asked for the best choice, and research changed the recommendation.
