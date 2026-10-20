import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  formatSpreadCaller,
  formatThinCaller,
  lintExtendingCaller,
  lintThinCaller,
  runBunConfig,
  typescriptThinCaller,
} from "../src/__tests__/sample-repo";
import { formatDeviations } from "../src/oxfmt";
import { lintDeviations } from "../src/oxlint";

/** The package's README, which ships in its npm package. */
const readmePath = path.join(import.meta.dir, "../README.md");

/** The text inside each fenced code block of the README, up to and with its last newline. */
async function fencedBlocks(): Promise<string[]> {
  const text = await Bun.file(readmePath).text();
  return [...text.matchAll(/^```\w*\n(?<body>[\s\S]*?)^```$/gmu)].map(
    ({ groups }) => groups?.body ?? "",
  );
}

/** Each row of the README's tables, as its cells with the spaces around them trimmed. */
async function tableRows(): Promise<string[][]> {
  const text = await Bun.file(readmePath).text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe("the @acmelabs/config README", () => {
  test("it has one table row for each deviation, which names its rule or option and holds its reason", async () => {
    const rows = await tableRows();
    const deviations = [...Object.entries(lintDeviations), ...Object.entries(formatDeviations)];
    const missing = deviations
      .filter(([name, deviation]) => {
        const named = rows.filter((cells) => cells[0] === `\`${name}\``);
        return named.length !== 1 || !named[0]?.includes(deviation.reason);
      })
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test("it shows each thin caller and the bunfig.toml word for word, as the sample-repo tests prove them", async () => {
    const blocks = await fencedBlocks();
    const shown = {
      lintThinCaller,
      lintExtendingCaller,
      formatThinCaller,
      formatSpreadCaller,
      typescriptThinCaller,
      runBunConfig,
    };
    const missing = Object.entries(shown)
      .filter(([, text]) => !blocks.includes(text))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});
