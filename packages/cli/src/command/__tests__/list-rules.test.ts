import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { defineCommand } from "../command";
import type { CommandList } from "../list";
import { commandListProblems, heavyImports } from "../list-rules";

describe("commandListProblems", () => {
  test("a list whose commands keep every rule has no problems", async () => {
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
    expect(await commandListProblems(list)).toEqual([]);
    expect(await commandListProblems([])).toEqual([]);
  });

  test("two commands with the same path give one problem that counts them", async () => {
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
    expect(await commandListProblems(list)).toEqual(["version sync: 2 commands have this path"]);
  });

  test("a path that is the start of another command's path gives a problem per longer path", async () => {
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
    expect(await commandListProblems(list)).toEqual([
      "version: the path is the start of the path of version sync",
      "version: the path is the start of the path of version check",
    ]);
  });

  test("an empty path gives one problem, and the command is named (no path)", async () => {
    const list: CommandList = [
      defineCommand({
        path: [],
        summary: "Print the version of acmelabs.",
        input: z.object({ short: z.boolean() }),
        run: () => Promise.resolve("0.1.0"),
      }),
      // An empty path is not the start of this path: it breaks its own rule only.
      defineCommand({
        path: ["version", "sync"],
        summary: "Write package.json's version into each manifest.",
        input: z.object({}),
        run: () => Promise.resolve("synced"),
      }),
    ];
    expect(await commandListProblems(list)).toEqual([
      "(no path): the path is empty; a path has one word or more",
      "(no path): the input field short has no description",
    ]);
  });

  test("a summary that is empty, or more than one line, gives a problem", async () => {
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
    expect(await commandListProblems(list)).toEqual([
      "version sync: the summary is empty",
      "version check: the summary is empty",
      "new: the summary is more than one line",
      "upgrade: the summary is more than one line",
    ]);
  });

  test("an input field with no description gives a problem that names the field", async () => {
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
      // A wrapper around a field with no description has none either.
      defineCommand({
        path: ["marketplace", "add"],
        summary: "Add a plugin repo to the marketplace.",
        input: z.object({ host: z.string().optional().nullable().default(null) }),
        run: () => Promise.resolve("added"),
      }),
    ];
    expect(await commandListProblems(list)).toEqual([
      "new: the input field kind has no description",
      "new: the input field public has no description",
      "marketplace add: the input field host has no description",
    ]);
  });

  test("a description counts before or after the optional, nullable and default wrappers", async () => {
    const list: CommandList = [
      defineCommand({
        path: ["marketplace", "add"],
        summary: "Add a plugin repo to the marketplace.",
        input: z.object({
          host: z.string().describe("The host to add it for.").optional(),
          tag: z.string().optional().describe("The tag the entry follows."),
          note: z.string().describe("A note for the entry.").nullable(),
          branch: z.string().describe("The branch the entry reads.").default("main"),
          owner: z.string().describe("The repo's owner.").nullable().optional().default(null),
        }),
        run: () => Promise.resolve("added"),
      }),
    ];
    expect(await commandListProblems(list)).toEqual([]);
  });

  test("a positional that names no input field, or an optional one, gives a problem", async () => {
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
    expect(await commandListProblems(list)).toEqual([
      "new: the positional folder names no input field",
      "marketplace add: the positional host names an optional input field",
      "marketplace add: the positional tag names an optional input field",
    ]);
  });

  test("a positional whose field has an async check is checked as any other", async () => {
    const list: CommandList = [
      defineCommand({
        path: ["marketplace", "add"],
        summary: "Add a plugin repo to the marketplace.",
        input: z.object({
          // Async checks, such as one that asks GitHub whether the repo exists. The first field is
          // required; the second fills a value when the caller leaves it out.
          repo: z
            .custom<string>((value) => Promise.resolve(typeof value === "string"))
            .describe("The plugin repo, as owner/name."),
          tag: z
            .preprocess((value) => Promise.resolve(value ?? "latest"), z.string())
            .describe("The tag the entry follows."),
        }),
        positionals: ["repo", "tag"],
        run: () => Promise.resolve("added"),
      }),
    ];
    expect(await commandListProblems(list)).toEqual([
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
    // A package, a sibling file, a side-effect import, a multi-line import, a
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
      "./drift",
      "../tui/theme",
      "@clack/prompts",
      "./version-sync",
      "libnpmpublish",
    ]);
  });

  test("a Node built-in loaded at the top is light: it costs less to load than zod", () => {
    // Measured on Bun 1.4.0, median of 15 starts: node:path 8 ms, node:fs/promises 11 ms, zod 20 ms.
    const text = `import path from "node:path";
import { stat } from "node:fs/promises";

export const tools = [path, stat];
`;
    expect(heavyImports(text)).toEqual([]);
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
