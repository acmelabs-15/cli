import { describe, expect, test } from "bun:test";
import path from "node:path";

import { commandListProblems, heavyImports } from "../../command/list-rules";
import { commands } from "../index";

/** The folder that holds the command files and the command list. */
const commandsFolder = path.join(import.meta.dir, "..");

describe("the command list", () => {
  test("keeps every rule: unique paths, one-line summaries, described fields, positionals", async () => {
    expect(await commandListProblems(commands)).toEqual([]);
  });
});

describe("the command files", () => {
  test("each one loads only zod, command-core and repo-model at its top", async () => {
    const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan({ cwd: commandsFolder }));
    // The scan reads the right folder: it finds the command list itself.
    expect(files).toContain("index.ts");
    const commandFiles = files
      .filter((file) => file !== "index.ts" && !file.split(path.sep).includes("__tests__"))
      .toSorted();
    const found: string[] = [];
    for (const file of commandFiles) {
      const text = await Bun.file(path.join(commandsFolder, file)).text();
      found.push(...heavyImports(text).map((specifier) => `${file} loads ${specifier} at its top`));
    }
    expect(found).toEqual([]);
  });
});
