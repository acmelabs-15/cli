import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  builtPackage,
  formatThinCaller,
  realNodeLine,
  sampleRepo,
} from "../../../../config/src/__tests__/sample-repo";
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

  test("reads a list of 10,000 distinct package paths in under 100 ms", async () => {
    const packages = Array.from({ length: 10_000 }, (_, index) => `packages/p${index}`);
    const root = await fixture("ten-thousand-packages", json({ library: { packages } }));
    const start = performance.now();
    const config = await readRepoConfig(root);
    const elapsed = performance.now() - start;
    expect(config).toEqual({ library: { packages } });
    expect(elapsed).toBeLessThan(100);
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

  test.each([
    ["array", "[]"],
    ["string", '"x"'],
    ["null", "null"],
  ])("a JSON %s, not an object: the error says what the file must hold", async (kind, text) => {
    const root = await fixture(`not-an-object-${kind}`, `${text}\n`);
    const error = await rejection(root);
    expect(error.file).toBe(`${root}/acmelabs.json`);
    expect(error.issues).toEqual([
      {
        path: "",
        message: 'the file must hold a JSON object with "plugin", "library" or both',
      },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: the file must hold a JSON object with "plugin", "library" or both`,
    );
  });

  test("a folder named acmelabs.json: the error says the path is a folder", async () => {
    const root = await fixture("folder-not-file");
    await mkdir(`${root}/acmelabs.json`);
    const error = await rejection(root);
    expect(error.file).toBe(`${root}/acmelabs.json`);
    expect(error.issues).toEqual([
      { path: "", message: "the path is a folder, not a file; acmelabs.json must be a file" },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: the path is a folder, not a file; acmelabs.json must be a file`,
    );
  });

  test("a file over 1 MiB: the error says so; a file of exactly 1 MiB still reads", async () => {
    const content = json({ library: { packages: ["."] } });
    const atCap = await fixture("size-at-cap", content.padEnd(1_048_576));
    expect(await readRepoConfig(atCap)).toEqual({ library: { packages: ["."] } });
    const overCap = await fixture("size-over-cap", content.padEnd(1_048_577));
    const error = await rejection(overCap);
    expect(error.file).toBe(`${overCap}/acmelabs.json`);
    expect(error.issues).toEqual([
      { path: "", message: "the file is larger than 1 MiB; a repo config is a few lines" },
    ]);
  });

  // Root reads a file whatever its mode, so a chmod 000 file is readable there.
  const runsAsRoot = process.getuid?.() === 0;

  test.skipIf(runsAsRoot)("an unreadable file: the error names the reason", async () => {
    const root = await fixture("unreadable", json({ library: { packages: ["."] } }));
    const file = `${root}/acmelabs.json`;
    await chmod(file, 0o000);
    try {
      const error = await rejection(root);
      expect(error.file).toBe(file);
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0]?.path).toBe("");
      expect(error.issues[0]?.message).toStartWith("the file cannot be read: ");
      expect(error.issues[0]?.message).toContain("permission denied");
    } finally {
      await chmod(file, 0o644);
    }
  });

  test("a device, not a regular file: the error says the file cannot be read", async () => {
    // A device such as /dev/zero reports size 0 and never ends; /dev/null is its safe stand-in.
    const root = await fixture("device-not-file");
    await symlink("/dev/null", `${root}/acmelabs.json`);
    const error = await rejection(root);
    expect(error.issues).toEqual([
      { path: "", message: "the file cannot be read: it is not a regular file" },
    ]);
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
      {
        path: "library.packages[0]",
        message:
          '"/abs/x" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
    ]);
    expect(error.message).toBe(
      `${root}/acmelabs.json: library.packages[0]: "/abs/x" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment`,
    );
  });

  test("a package path with a .. segment: the error names each such field", async () => {
    const root = await fixture(
      "dot-dot-segment-package",
      json({
        library: {
          packages: ["../sibling", "packages/../..", "..cache", "packages/../packages/config"],
        },
      }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[0]",
        message:
          '"../sibling" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
      {
        path: "library.packages[1]",
        message:
          '"packages/../.." is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
      {
        path: "library.packages[3]",
        message:
          '"packages/../packages/config" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
    ]);
  });

  test("an empty package path: the error names the field", async () => {
    const root = await fixture("empty-package-path", json({ library: { packages: [""] } }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[0]",
        message:
          '"" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
    ]);
  });

  test("a blank package path: the error names each such field", async () => {
    const root = await fixture("blank-package-path", json({ library: { packages: [" ", "\t"] } }));
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[0]",
        message:
          '" " is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
      {
        path: "library.packages[1]",
        message: String.raw`"\t" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment`,
      },
    ]);
  });

  test("a package path with a drive prefix: the error names each such field", async () => {
    const root = await fixture(
      "drive-prefix-package",
      json({ library: { packages: ["C:/x", "c:x", "packages/cli"] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[0]",
        message:
          '"C:/x" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
      {
        path: "library.packages[1]",
        message:
          '"c:x" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment',
      },
    ]);
  });

  test("a package path with a backslash: the error names each such field", async () => {
    const root = await fixture(
      "backslash-package",
      json({ library: { packages: [String.raw`packages\cli`, String.raw`a\..\..\x`] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[0]",
        message: String.raw`"packages\\cli" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment`,
      },
      {
        path: "library.packages[1]",
        message: String.raw`"a\\..\\..\\x" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment`,
      },
    ]);
  });

  test("a package path with a NUL character: the error names the field", async () => {
    const root = await fixture(
      "nul-package",
      json({ library: { packages: ["packages/cli\u0000"] } }),
    );
    const error = await rejection(root);
    expect(error.issues).toEqual([
      {
        path: "library.packages[0]",
        message: String.raw`"packages/cli\u0000" is not a relative path inside the repo; write it from the repo root, with "/" between folders and no ".." segment`,
      },
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

  test("a repo kind's line of 100 columns stays on one line", () => {
    const text = formatRepoConfig(
      {
        library: {
          packages: ["packages/alpha-core", "packages/beta-tools", "packages/gamma-engine"],
        },
      },
      "./schema.json",
    );
    expect(text).toBe(`{
  "$schema": "./schema.json",
  "library": { "packages": ["packages/alpha-core", "packages/beta-tools", "packages/gamma-engine"] }
}
`);
    expect(text.split("\n")[2]).toHaveLength(100);
  });

  test("a line over 100 columns opens the repo kind's object; its list stays on one line when it fits there", () => {
    // On one line, the library line would be 101 columns.
    const text = formatRepoConfig(
      {
        library: {
          packages: ["packages/alpha-core", "packages/beta-tools", "packages/gamma-runtime"],
        },
      },
      "./schema.json",
    );
    expect(text).toBe(`{
  "$schema": "./schema.json",
  "library": {
    "packages": ["packages/alpha-core", "packages/beta-tools", "packages/gamma-runtime"]
  }
}
`);
  });

  test("a list too long for its own line puts one item per line", () => {
    const text = formatRepoConfig(
      {
        library: {
          packages: [
            "packages/alpha-core",
            "packages/beta-tools",
            "packages/gamma-runtime",
            "packages/delta-ui",
            "packages/epsilon-cli",
          ],
        },
      },
      "./schema.json",
    );
    expect(text).toBe(`{
  "$schema": "./schema.json",
  "library": {
    "packages": [
      "packages/alpha-core",
      "packages/beta-tools",
      "packages/gamma-runtime",
      "packages/delta-ui",
      "packages/epsilon-cli"
    ]
  }
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

/** A list of strings as one line of JSON: `["a", "b"]`. */
function oneLineList(items: readonly string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
}

/**
 * A repo config's text in its one-line form, as formatRepoConfig wrote it before it took oxfmt's
 * layout: each repo kind's object on one line, whatever its width.
 */
function oneLineForm(config: RepoConfig, schemaPath: string): string {
  const lines = [`  "$schema": ${JSON.stringify(schemaPath)}`];
  if (config.plugin !== undefined) {
    lines.push(`  "plugin": { "hosts": ${oneLineList(config.plugin.hosts)} }`);
  }
  if (config.library !== undefined) {
    lines.push(`  "library": { "packages": ${oneLineList(config.library.packages)} }`);
  }
  return `{\n${lines.join(",\n")}\n}\n`;
}

describe("formatRepoConfig's output in a sample repo with the format preset", () => {
  beforeAll(async () => {
    // The first call builds @acmelabs/config, which can take longer than the default 5 s.
    await builtPackage();
  }, 30_000);

  test("bun run format:check leaves the output unchanged in every layout", async () => {
    const cases: Record<string, RepoConfig> = {
      "plugin-only": { plugin: { hosts: ["claude-code"] } },
      "all-four-hosts": {
        plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
      },
      "one-package": { library: { packages: ["."] } },
      // On one line, 100 columns: it fits, so it stays.
      "library-line-of-100-columns": {
        library: {
          packages: ["packages/alpha-core", "packages/beta-tools", "packages/gamma-engine"],
        },
      },
      // On one line, 101 columns: the object opens, and the list fits on its own line.
      "library-line-of-101-columns": {
        library: {
          packages: ["packages/alpha-core", "packages/beta-tools", "packages/gamma-runtime"],
        },
      },
      // The list does not fit on its own line either: one package per line.
      "five-packages": {
        library: {
          packages: [
            "packages/alpha-core",
            "packages/beta-tools",
            "packages/gamma-runtime",
            "packages/delta-ui",
            "packages/epsilon-cli",
          ],
        },
      },
      // On one line, 95 characters but 102 columns: each of the seven wide characters takes two
      // columns, as oxfmt counts them.
      "wide-characters": {
        library: {
          packages: ["packages/alpha-core", "packages/beta-tools", "packages/日本語ツール集"],
        },
      },
      "both-kinds": {
        plugin: { hosts: ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
        library: { packages: ["packages/cli", "packages/config"] },
      },
    };
    const files = Object.fromEntries(
      Object.entries(cases).map(([name, config]) => [
        `cases/${name}.json`,
        formatRepoConfig(config, "./node_modules/@acmelabs/cli/schema/acmelabs.schema.json"),
      ]),
    );
    const repo = await sampleRepo(work, {
      files: { "oxfmt.config.ts": formatThinCaller, ...files },
    });
    const run = await repo.run("format:check");
    expect(run.output).not.toContain("cases/");
    expect(run.output).toContain("All matched files use the correct format.");
    // package.json, bunfig.toml, oxfmt.config.ts and the eight cases: each one is checked.
    expect(run.output).toContain(" on 11 files ");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(0);
  });

  test("bun run format turns each repo kind's one-line form into formatRepoConfig's text", async () => {
    // oxfmt keeps an object open that was open in its input, so the check above passes at any
    // width above the preset's. Only the one-line form shows where oxfmt breaks a line.
    const schemaPath = "./node_modules/@acmelabs/cli/schema/acmelabs.schema.json";
    const cases: Record<string, RepoConfig> = {
      // On one line, 100 columns: a narrower width opens it.
      "library-line-of-100-columns": {
        library: {
          packages: ["packages/alpha-core", "packages/beta-tools", "packages/gamma-engine"],
        },
      },
      // On one line, 101 columns: a wider width keeps it on one line.
      "library-line-of-101-columns": {
        library: {
          packages: ["packages/alpha-core", "packages/beta-tools", "packages/gamma-runtime"],
        },
      },
      // The list does not fit on its own line either: one package per line.
      "five-packages": {
        library: {
          packages: [
            "packages/alpha-core",
            "packages/beta-tools",
            "packages/gamma-runtime",
            "packages/delta-ui",
            "packages/epsilon-cli",
          ],
        },
      },
    };
    const files = Object.fromEntries(
      Object.entries(cases).map(([name, config]) => [
        `cases/${name}.json`,
        oneLineForm(config, schemaPath),
      ]),
    );
    const repo = await sampleRepo(work, {
      files: { "oxfmt.config.ts": formatThinCaller, ...files },
    });
    const run = await repo.run("format");
    expect(run.output).not.toContain(realNodeLine);
    expect(run.exitCode).toBe(0);
    const formatted: Record<string, string> = {};
    for (const name of Object.keys(cases)) {
      formatted[name] = await Bun.file(path.join(repo.root, "cases", `${name}.json`)).text();
    }
    expect(formatted).toEqual(
      Object.fromEntries(
        Object.entries(cases).map(([name, config]) => [name, formatRepoConfig(config, schemaPath)]),
      ),
    );
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
