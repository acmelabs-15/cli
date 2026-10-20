import type { CommandList } from "../command/list";

/**
 * The command list: one line per command. Every front-end, the help output and the agent guide
 * read it. It is empty until `repo-checks` adds the first commands.
 */
export const commands: CommandList = [];
