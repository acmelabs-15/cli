import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { defineCommand } from "../command";
import type { CommandList } from "../list";
import { commandListProblems, heavyImports } from "../list";

describe("commandListProblems", () => {
  test("a list whose commands keep every rule has no problems", () => {
    // The list's type holds commands with different inputs and results: tsc checks that in
    // `bun run typecheck`.
    const list: CommandList = [
      defineCommand({
        path: ["version", "sync"],
        summary: "Write package.json's version into each manifest.",
        input: z.object({}),
        run: () => Promise.resolve({ synced: 3 }),
      }),
      defineCommand({
        path: ["version", "check"],
        summary: "Fail when a manifest's version disagrees with package.json.",
        input: z.object({
          host: z.enum(["claude-code", "codex"]).optional().describe("Check one host only."),
        }),
        run: () => Promise.resolve("checked"),
      }),
      defineCommand({
        path: ["new"],
        summary: "Create an ACMElabs repo.",
        input: z.object({
          name: z.string().describe("The repo's name."),
          kind: z.enum(["plugin", "library"]).describe("What the repo releases."),
        }),
        positionals: ["name"],
        run: (input) => Promise.resolve([input.name, input.kind]),
      }),
    ];
    expect(commandListProblems(list)).toEqual([]);
    expect(commandListProblems([])).toEqual([]);
  });

  test("two commands with the same path give one problem that counts them", () => {
    const list: CommandList = [
      defineCommand({
        path: ["version", "sync"],
        summary: "Write package.json's version into each manifest.",
        input: z.object({}),
        run: () => Promise.resolve("synced"),
      }),
      defineCommand({
        path: ["version", "check"],
        summary: "Fail when a manifest's version disagrees with package.json.",
        input: z.object({}),
        run: () => Promise.resolve("checked"),
      }),
      defineCommand({
        path: ["version", "sync"],
        summary: "Write the version into each manifest, a second time.",
        input: z.object({}),
        run: () => Promise.resolve("synced again"),
      }),
    ];
    expect(commandListProblems(list)).toEqual(["version sync: 2 commands have this path"]);
  });

  test("a path that is the start of another command's path gives a problem per longer path", () => {
    const list: CommandList = [
      defineCommand({
        path: ["version"],
        summary: "Print the version of acmelabs.",
        input: z.object({}),
        run: () => Promise.resolve("0.1.0"),
      }),
      defineCommand({
        path: ["version", "sync"],
        summary: "Write package.json's version into each manifest.",
        input: z.object({}),
        run: () => Promise.resolve("synced"),
      }),
      defineCommand({
        path: ["version", "check"],
        summary: "Fail when a manifest's version disagrees with package.json.",
        input: z.object({}),
        run: () => Promise.resolve("checked"),
      }),
      // Paths compare word by word: "version" is not the start of "versions".
      defineCommand({
        path: ["versions"],
        summary: "List the published versions.",
        input: z.object({}),
        run: () => Promise.resolve(["0.1.0"]),
      }),
    ];
    expect(commandListProblems(list)).toEqual([
      "version: the path is the start of the path of version sync",
      "version: the path is the start of the path of version check",
    ]);
  });

  test("a summary that is empty, or more than one line, gives a problem", () => {
    const list: CommandList = [
      defineCommand({
        path: ["version", "sync"],
        summary: "",
        input: z.object({}),
        run: () => Promise.resolve("synced"),
      }),
      // Spaces only: a reader sees no summary.
      defineCommand({
        path: ["version", "check"],
        summary: "   ",
        input: z.object({}),
        run: () => Promise.resolve("checked"),
      }),
      defineCommand({
        path: ["new"],
        summary: "Create an ACMElabs repo.\nIt asks for the repo kind.",
        input: z.object({}),
        run: () => Promise.resolve("created"),
      }),
      // The Unicode line separator breaks the line too, as NEL and the paragraph separator do.
      defineCommand({
        path: ["upgrade"],
        summary: "Upgrade the running copy.\u2028Then sync the repo.",
        input: z.object({}),
        run: () => Promise.resolve("upgraded"),
      }),
    ];
    expect(commandListProblems(list)).toEqual([
      "version sync: the summary is empty",
      "version check: the summary is empty",
      "new: the summary is more than one line",
      "upgrade: the summary is more than one line",
    ]);
  });

  test("an input field with no description gives a problem that names the field", () => {
    const list: CommandList = [
      defineCommand({
        path: ["new"],
        summary: "Create an ACMElabs repo.",
        input: z.object({
          name: z.string().describe("The repo's name."),
          kind: z.enum(["plugin", "library"]),
          public: z.boolean().describe(""),
        }),
        run: () => Promise.resolve("created"),
      }),
      // A description given before .optional() stays on the inner schema. The field's own schema,
      // which a question reads, has none.
      defineCommand({
        path: ["marketplace", "add"],
        summary: "Add a plugin repo to the marketplace.",
        input: z.object({
          host: z.string().describe("The host to add it for.").optional(),
          tag: z.string().optional().describe("The tag the entry follows."),
        }),
        run: () => Promise.resolve("added"),
      }),
    ];
    expect(commandListProblems(list)).toEqual([
      "new: the input field kind has no description",
      "new: the input field public has no description",
      "marketplace add: the input field host has no description",
    ]);
  });

  test("a positional that names no input field, or an optional one, gives a problem", () => {
    const list: CommandList = [
      defineCommand({
        path: ["new"],
        summary: "Create an ACMElabs repo.",
        input: z.object({ name: z.string().describe("The repo's name.") }),
        // The type stops this too; the rule catches a list that gets past the type.
        // @ts-expect-error -- the input has no field named folder.
        positionals: ["name", "folder"],
        run: () => Promise.resolve("created"),
      }),
      // A caller may leave out an optional field and a field with a default, so neither is
      // required.
      defineCommand({
        path: ["marketplace", "add"],
        summary: "Add a plugin repo to the marketplace.",
        input: z.object({
          repo: z.string().describe("The plugin repo, as owner/name."),
          host: z.string().optional().describe("The host to add it for."),
          tag: z.string().default("latest").describe("The tag the entry follows."),
        }),
        positionals: ["repo", "host", "tag"],
        run: () => Promise.resolve("added"),
      }),
    ];
    expect(commandListProblems(list)).toEqual([
      "new: the positional folder names no input field",
      "marketplace add: the positional host names an optional input field",
      "marketplace add: the positional tag names an optional input field",
    ]);
  });
});

describe("heavyImports", () => {
  test("a command file that imports only zod, command-core and repo-model has none", () => {
    const text = `import { z } from "zod";

import { defineCommand } from "../command/command";
import type { Json } from "../command/outcome";
import { problem } from "../command/outcome";
import { readRepoConfig } from "../repo/config";

export const versionCheck = defineCommand({
  path: ["version", "check"],
  summary: "Fail when a manifest's version disagrees with package.json.",
  input: z.object({}),
  async run(_input, context) {
    const config = await readRepoConfig(context.root);
    if (config.plugin === undefined) {
      throw problem("the repo releases no plugin");
    }
    const checked: Json = config.plugin.hosts.length;
    return checked;
  },
});
`;
    expect(heavyImports(text)).toEqual([]);
  });

  test("any other module loaded at the top is heavy, named in the order the file loads it", () => {
    // A package, a Node module, a sibling file, a side-effect import, a multi-line import, a
    // re-export and a require: each loads at the top, before run starts.
    const text = `import { z } from "zod";
import { Octokit } from "@octokit/rest";
import path from "node:path";
import { findDrift } from "./drift";
import "../tui/theme";
import {
  intro,
  outro,
} from "@clack/prompts";
import { defineCommand } from "../command/command";
export { versionSync } from "./version-sync";
const npm = require("libnpmpublish");

export const tools = [z, Octokit, path, findDrift, intro, outro, defineCommand, npm];
`;
    expect(heavyImports(text)).toEqual([
      "@octokit/rest",
      "node:path",
      "./drift",
      "../tui/theme",
      "@clack/prompts",
      "./version-sync",
      "libnpmpublish",
    ]);
  });

  test("a module loaded in run with await import(...), or for its types only, is not heavy", () => {
    // Bun drops a type-only import, so it loads nothing at the top.
    const text = `import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { type Page } from "@clack/prompts";

import { defineCommand } from "../command/command";

export const login = defineCommand({
  path: ["login"],
  summary: "Check the GitHub login.",
  input: z.object({}),
  async run() {
    const { Octokit: Client } = await import("@octokit/rest");
    const client: Octokit = new Client();
    const page: Page | undefined = undefined;
    return { login: client === undefined ? null : "octocat", page: page ?? null };
  },
});
`;
    expect(heavyImports(text)).toEqual([]);
  });

  test("an import inside a comment or a string is not an import", () => {
    const text = `import { z } from "zod";

// import { Octokit } from "@octokit/rest";
/* import "../tui/theme"; */
export const hint = 'Copy the files from "../templates" to the repo.';
export const example = \`import { intro } from "@clack/prompts";\`;
export const input = z.object({});
`;
    expect(heavyImports(text)).toEqual([]);
  });
});
