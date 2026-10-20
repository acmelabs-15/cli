import type { RepoConfig } from "./config";

/** The id of each host, in host-table order. */
export const hostIds = ["claude-code", "codex", "gemini-cli", "antigravity-cli"] as const;

/** One host's id. */
export type HostId = (typeof hostIds)[number];

/** A host's manifest: its path from the repo root, and its version field's dot path or null. */
export type Manifest = { host: HostId; path: string; version: string | null };

/**
 * A host's validator: the command line that checks a plugin, and `required`, true when a missing tool
 * fails the check.
 */
export type Validator = { host: HostId; commandLine: readonly string[]; required: boolean };

/** A manifest as the host table lists it: a Manifest without its host. */
type ManifestEntry = Omit<Manifest, "host">;

/** A validator as the host table lists it: a Validator without its host. */
type ValidatorEntry = Omit<Validator, "host">;

/** One host in the host table: its name, and the manifests and validators of a plugin it loads. */
export type Host = {
  name: string;
  manifests: readonly ManifestEntry[];
  validators: readonly ValidatorEntry[];
};

/** The host table: each host's name, manifests and validators, in `hostIds` order. */
export const hosts: Readonly<Record<HostId, Host>> = {
  "claude-code": {
    name: "Claude Code",
    manifests: [
      { path: ".claude-plugin/plugin.json", version: "version" },
      { path: ".claude-plugin/marketplace.json", version: "plugins.0.version" },
    ],
    validators: [
      { commandLine: ["claude", "plugin", "validate", ".", "--strict"], required: true },
      {
        commandLine: ["claude", "plugin", "validate", ".claude-plugin/plugin.json", "--strict"],
        required: true,
      },
    ],
  },
  codex: {
    name: "Codex",
    manifests: [
      { path: ".codex-plugin/plugin.json", version: "version" },
      { path: ".agents/plugins/marketplace.json", version: "plugins.0.version" },
    ],
    validators: [],
  },
  "gemini-cli": {
    name: "Gemini CLI",
    manifests: [{ path: "gemini-extension.json", version: "version" }],
    validators: [{ commandLine: ["gemini", "extensions", "validate", "."], required: false }],
  },
  "antigravity-cli": {
    name: "Antigravity CLI",
    manifests: [{ path: "plugin.json", version: null }],
    validators: [{ commandLine: ["agy", "plugin", "validate", "."], required: false }],
  },
};

/** The repo's hosts in `hostIds` order, whatever their order in the repo config. */
function declaredHosts(config: RepoConfig): HostId[] {
  const declared = new Set(config.plugin?.hosts);
  return hostIds.filter((id) => declared.has(id));
}

/** Every manifest of the repo's hosts, in `hostIds` order. Empty for a library-only repo. */
export function manifestsFor(config: RepoConfig): Manifest[] {
  return declaredHosts(config).flatMap((id) =>
    hosts[id].manifests.map((manifest) => ({ host: id, ...manifest })),
  );
}

/** Every validator of the repo's hosts, in `hostIds` order. */
export function validatorsFor(config: RepoConfig): Validator[] {
  return declaredHosts(config).flatMap((id) =>
    hosts[id].validators.map((validator) => ({ host: id, ...validator })),
  );
}
