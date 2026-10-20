import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RepoConfig } from "../config";
import { RepoConfigError, formatRepoConfig, readRepoConfig } from "../config";

let work: string;

/** A fixture repo folder; with text, it holds an acmelabs.json with that text. */
async function fixture(name: string, text?: string): Promise<string> {
  const root = `${work}/${name}`;
  await mkdir(root, { recursive: true });
  if (text !== undefined) {
    await Bun.write(`${root}/acmelabs.json`, text);
  }
  return root;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The RepoConfigError that readRepoConfig throws for the repo at root. */
async function rejection(root: string): Promise<RepoConfigError> {
  try {
    await readRepoConfig(root);
  } catch (error) {
    if (error instanceof RepoConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error(`readRepoConfig did not throw for ${root}`);
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "acmelabs-config-"));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("readRepoConfig", () => {
  test("reads a plugin-only repo config, typed, without the $schema line", async () => {
    const root = await fixture(
      "plugin-only",
      json({
        $schema: "./node_modules/@acmelabs/cli/schema/acmelabs.schema.json",
        plugin: { hosts: ["claude-code"] },
      }),
    );
    const config = await readRepoConfig(root);
    expect(config).toEqual({ plugin: { hosts: ["claude-code"] } });
    expectTypeOf(config).toEqualTypeOf<RepoConfig>();
  });

  test("reads a library-only repo config", async () => {
    const root = await fixture("library-only", json({ library: { packages: ["."] } }));
    expect(await readRepoConfig(root)).toEqual({ library: { packages: ["."] } });
  });

  test("reads a repo config with both repo kinds", async () => {
    const both: RepoConfig = {
      plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
      library: { packages: ["packages/cli", "packages/config"] },
    };
    const root = await fixture(
      "both-kinds",
      json({ $schema: "./packages/cli/schema/acmelabs.schema.json", ...both }),
    );
    expect(await readRepoConfig(root)).toEqual(both);
  });

  test("returns each package path in normal form: no leading ./, no trailing /", async () => {
    const root = await fixture(
      "package-normal-form",
      json({ library: { packages: ["./packages/cli", "packages/config/"] } }),
    );
    expect(await readRepoConfig(root)).toEqual({
      library: { packages: ["packages/cli", "packages/config"] },
    });
  });

  test('returns a single-package library repo\'s "./" as "."', async () => {
    const root = await fixture("package-dot-slash", json({ library: { packages: ["./"] } }));
    expect(await readRepoConfig(root)).toEqual({ library: { packages: ["."] } });
  });
});

describe("readRepoConfig errors", () => {
  test("no file: the error names the path it looked for", async () => {
    const root = await fixture("no-file");
    const error = await rejection(root);
    expect(error.file).toBe(`${root}/acmelabs.json`);
    expect(error.issues).toEqual([
      { path: "", message: 'the file does not exist; create it with "plugin", "library" or both' },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: the file does not exist; create it with "plugin", "library" or both`,
    );
  });

  test("invalid JSON: the error names the file and the parse error", async () => {
    const root = await fixture("invalid-json", '{ "plugin": ');
    const error = await rejection(root);
    expect(error.file).toBe(`${root}/acmelabs.json`);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toBe("");
    expect(error.message).toStartWith(`${root}/acmelabs.json: the file is not valid JSON: `);
  });

  test("neither repo kind: the error names both fields", async () => {
    const root = await fixture("neither-kind", json({ $schema: "./acmelabs.schema.json" }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "",
        message: 'neither "plugin" nor "library" is present; declare at least one repo kind',
      },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: neither "plugin" nor "library" is present; declare at least one repo kind`,
    );
  });

  test("an empty host list: the error names plugin.hosts", async () => {
    const root = await fixture("empty-hosts", json({ plugin: { hosts: [] } }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "plugin.hosts", message: "the list is empty; name at least one host" },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: plugin.hosts: the list is empty; name at least one host`,
    );
  });

  test("a plugin with no hosts field: the error names plugin.hosts", async () => {
    const root = await fixture("missing-hosts", json({ plugin: {} }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "plugin.hosts", message: "the field is missing; name at least one host" },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: plugin.hosts: the field is missing; name at least one host`,
    );
  });

  test("an unknown host: the error names the field and lists the hosts", async () => {
    const root = await fixture(
      "unknown-host",
      json({ plugin: { hosts: ["claude-code", "claude"] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "plugin.hosts[1]",
        message:
          '"claude" is not a host; the hosts are claude-code, codex, gemini-cli, antigravity-cli',
      },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: plugin.hosts[1]: "claude" is not a host; the hosts are claude-code, codex, gemini-cli, antigravity-cli`,
    );
  });

  test("a repeated host: the error names the repeat", async () => {
    const root = await fixture(
      "repeated-host",
      json({ plugin: { hosts: ["claude-code", "codex", "claude-code"] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "plugin.hosts[2]",
        message: '"claude-code" is already in the list; name each host once',
      },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: plugin.hosts[2]: "claude-code" is already in the list; name each host once`,
    );
  });

  test("an empty package list: the error names library.packages", async () => {
    const root = await fixture("empty-packages", json({ library: { packages: [] } }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "library.packages", message: "the list is empty; name at least one package" },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: library.packages: the list is empty; name at least one package`,
    );
  });

  test("a library with no packages field: the error names library.packages", async () => {
    const root = await fixture("missing-packages", json({ library: {} }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "library.packages", message: "the field is missing; name at least one package" },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: library.packages: the field is missing; name at least one package`,
    );
  });

  test("a repeated package: the error names the repeat", async () => {
    const root = await fixture(
      "repeated-package",
      json({ library: { packages: ["packages/cli", "packages/cli"] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[1]",
        message: '"packages/cli" is already in the list; name each package once',
      },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: library.packages[1]: "packages/cli" is already in the list; name each package once`,
    );
  });

  test("a repeated package in another spelling: the error names the repeat", async () => {
    const root = await fixture(
      "repeated-package-spelling",
      json({ library: { packages: ["packages/cli", "./packages/cli/"] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[1]",
        message: '"packages/cli" is already in the list; name each package once',
      },
    ]);
  });

  test("an absolute package path: the error names the field", async () => {
    const root = await fixture("absolute-package", json({ library: { packages: ["/abs/x"] } }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "library.packages[0]", message: '"/abs/x" is not a relative path inside the repo' },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: library.packages[0]: "/abs/x" is not a relative path inside the repo`,
    );
  });

  test("a package path that leaves the repo: the error names each such field", async () => {
    const root = await fixture(
      "package-outside-repo",
      json({ library: { packages: ["../sibling", "packages/../..", "..cache"] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[0]",
        message: '"../sibling" is not a relative path inside the repo',
      },
      {
        path: "library.packages[1]",
        message: '"packages/../.." is not a relative path inside the repo',
      },
    ]);
  });

  test("an empty package path: the error names the field", async () => {
    const root = await fixture("empty-package-path", json({ library: { packages: [""] } }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "library.packages[0]", message: '"" is not a relative path inside the repo' },
    ]);
  });

  test("an unknown field: the error names the field and lists the fields", async () => {
    const root = await fixture(
      "unknown-field",
      json({ plugin: { hosts: ["codex"] }, libary: { packages: ["."] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "libary", message: "unknown field; the fields are $schema, plugin, library" },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: libary: unknown field; the fields are $schema, plugin, library`,
    );
  });

  test("an unknown field inside a repo kind: the error names its full path", async () => {
    const root = await fixture(
      "unknown-nested-field",
      json({ plugin: { hosts: ["codex"], host: "gemini-cli" } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "plugin.host", message: "unknown field; the fields are hosts" },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: plugin.host: unknown field; the fields are hosts`,
    );
  });
});

describe("formatRepoConfig", () => {
  test("a plugin-only repo config: the spec's jev-gate example, two lines of content", () => {
    const text = formatRepoConfig(
      { plugin: { hosts: ["claude-code"] } },
      "./node_modules/@acmelabs/cli/schema/acmelabs.schema.json",
    );
    expect(text).toBe(`{
  "$schema": "./node_modules/@acmelabs/cli/schema/acmelabs.schema.json",
  "plugin": { "hosts": ["claude-code"] }
}
`);
  });

  test("both repo kinds: $schema, then plugin, then library, whatever the config's key order", () => {
    const text = formatRepoConfig(
      {
        library: { packages: ["packages/cli", "packages/config"] },
        plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
      },
      "./packages/cli/schema/acmelabs.schema.json",
    );
    expect(text).toBe(`{
  "$schema": "./packages/cli/schema/acmelabs.schema.json",
  "plugin": { "hosts": ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
  "library": { "packages": ["packages/cli", "packages/config"] }
}
`);
  });

  test("a library-only repo config: no plugin line", () => {
    const text = formatRepoConfig({ library: { packages: ["."] } }, "./schema.json");
    expect(text).toBe(`{
  "$schema": "./schema.json",
  "library": { "packages": ["."] }
}
`);
  });

  test("reads back equal, and a second format is byte-identical", async () => {
    const config: RepoConfig = {
      plugin: { hosts: ["codex", "claude-code"] },
      library: { packages: ["."] },
    };
    const schemaPath = "./node_modules/@acmelabs/cli/schema/acmelabs.schema.json";
    const text = formatRepoConfig(config, schemaPath);
    const root = await fixture("format-round-trip", text);
    const readBack = await readRepoConfig(root);
    expect(readBack).toEqual(config);
    expect(formatRepoConfig(readBack, schemaPath)).toBe(text);
  });
});

describe("this repo's acmelabs.json", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../../../..");

  test("declares the plugin with all four hosts and the library with both packages", async () => {
    expect(await readRepoConfig(repoRoot)).toEqual({
      plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
      library: { packages: ["packages/cli", "packages/config"] },
    });
  });

  test("holds formatRepoConfig's text for its own config", async () => {
    const config = await readRepoConfig(repoRoot);
    const text = await Bun.file(path.join(repoRoot, "acmelabs.json")).text();
    expect(text).toBe(formatRepoConfig(config, "./packages/cli/schema/acmelabs.schema.json"));
  });
});
