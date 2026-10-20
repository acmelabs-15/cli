/** The id of each host, in host-table order. */
export const hostIds = ["claude-code", "codex", "gemini-cli", "antigravity-cli"] as const;

/** One host's id. */
export type HostId = (typeof hostIds)[number];
