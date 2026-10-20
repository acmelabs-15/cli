import { describe, expect, expectTypeOf, test } from "bun:test";

import type { HostId, Manifest, Validator } from "../hosts";
import { hostIds, hosts, manifestsFor, validatorsFor } from "../hosts";

describe("hostIds", () => {
  test("names the four hosts in host-table order", () => {
    expect(hostIds).toEqual(["claude-code", "codex", "gemini-cli", "antigravity-cli"]);
  });

  test("HostId is exactly the four host ids", () => {
    expectTypeOf<HostId>().toEqualTypeOf<
      "claude-code" | "codex" | "gemini-cli" | "antigravity-cli"
    >();
  });
});

describe("hosts", () => {
  test("names each host as the glossary does, in hostIds order", () => {
    expect(Object.entries(hosts).map(([id, host]) => [id, host.name])).toEqual([
      ["claude-code", "Claude Code"],
      ["codex", "Codex"],
      ["gemini-cli", "Gemini CLI"],
      ["antigravity-cli", "Antigravity CLI"],
    ]);
  });
});

describe("manifestsFor", () => {
  test("claude-code alone: jev-gate's two manifests", () => {
    expect(manifestsFor({ plugin: { hosts: ["claude-code"] } })).toEqual([
      { host: "claude-code", path: ".claude-plugin/plugin.json", version: "version" },
      {
        host: "claude-code",
        path: ".claude-plugin/marketplace.json",
        version: "plugins.0.version",
      },
    ]);
  });

  test("all four hosts: the versioned manifests are brain's five, in brain's order", () => {
    const manifests = manifestsFor({
      plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
    });
    const versioned = manifests
      .filter((manifest) => manifest.version !== null)
      .map(({ path, version }) => ({ path, version }));
    // brain's scripts/version/version-sync.ts, in its order.
    expect(versioned).toEqual([
      { path: ".claude-plugin/plugin.json", version: "version" },
      { path: ".claude-plugin/marketplace.json", version: "plugins.0.version" },
      { path: ".codex-plugin/plugin.json", version: "version" },
      { path: ".agents/plugins/marketplace.json", version: "plugins.0.version" },
      { path: "gemini-extension.json", version: "version" },
    ]);
  });

  test("all four hosts: only Antigravity's plugin.json has no version field", () => {
    const manifests = manifestsFor({
      plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
    });
    expect(manifests.filter((manifest) => manifest.version === null)).toEqual([
      { host: "antigravity-cli", path: "plugin.json", version: null },
    ]);
  });

  test("keeps host-table order, whatever the order of plugin.hosts", () => {
    const manifests = manifestsFor({
      plugin: { hosts: ["antigravity-cli", "gemini-cli", "codex", "claude-code"] },
    });
    expect(manifests.map((manifest) => manifest.host)).toEqual([
      "claude-code",
      "claude-code",
      "codex",
      "codex",
      "gemini-cli",
      "antigravity-cli",
    ]);
  });

  test("a library-only config has no manifests", () => {
    expect(manifestsFor({ library: { packages: ["."] } })).toEqual([]);
  });

  test("Manifest is a host, a path and a version field or null", () => {
    expectTypeOf<Manifest>().toEqualTypeOf<{
      host: HostId;
      path: string;
      version: string | null;
    }>();
  });
});

describe("validatorsFor", () => {
  test("all four hosts: the table's validators, with the table's required values", () => {
    const validators = validatorsFor({
      plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
    });
    expect(validators).toEqual([
      {
        host: "claude-code",
        commandLine: ["claude", "plugin", "validate", ".", "--strict"],
        required: true,
      },
      {
        host: "claude-code",
        commandLine: ["claude", "plugin", "validate", ".claude-plugin/plugin.json", "--strict"],
        required: true,
      },
      {
        host: "gemini-cli",
        commandLine: ["gemini", "extensions", "validate", "."],
        required: false,
      },
      { host: "antigravity-cli", commandLine: ["agy", "plugin", "validate", "."], required: false },
    ]);
  });

  test("keeps host-table order, whatever the order of plugin.hosts", () => {
    const validators = validatorsFor({
      plugin: { hosts: ["antigravity-cli", "gemini-cli", "codex", "claude-code"] },
    });
    expect(validators.map((validator) => validator.host)).toEqual([
      "claude-code",
      "claude-code",
      "gemini-cli",
      "antigravity-cli",
    ]);
  });

  test("a library-only config has no validators", () => {
    expect(validatorsFor({ library: { packages: ["."] } })).toEqual([]);
  });

  test("Validator is a host, a command line and whether it is required", () => {
    expectTypeOf<Validator>().toEqualTypeOf<{
      host: HostId;
      commandLine: readonly string[];
      required: boolean;
    }>();
  });
});
