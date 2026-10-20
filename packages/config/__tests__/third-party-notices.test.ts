import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";

import { builtPackage } from "../src/__tests__/sample-repo";

beforeAll(async () => {
  // The first call builds the package, which can take longer than the default 5 s.
  await builtPackage();
}, 30_000);

/** The notice file, by path from the package folder. */
const noticeFile = "THIRD-PARTY-NOTICES.md";

/**
 * Ultracite's copyright and permission notice, word for word from its license.md at the tag of
 * the version the package bundles:
 * https://github.com/haydenbleasel/ultracite/blob/ultracite%407.12.0/license.md
 */
const ultraciteNotice = [
  "Copyright (c) 2022 — Present Hayden Bleasel",
  "",
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  "",
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  "",
].join("\n");

describe("Ultracite's notice in the shipped files", () => {
  test("the package ships Ultracite's copyright and permission notice, word for word", async () => {
    const files = await builtPackage();
    expect(files.get(noticeFile) ?? "").toContain(ultraciteNotice);
  });

  test.each(["dist/oxlint.js", "dist/oxfmt.js"])(
    "%s opens with a comment that names Ultracite and its license, and points at the shipped notice",
    async (file) => {
      const files = await builtPackage();
      const built = files.get(file) ?? "";
      // The comment above the first import.
      const banner = built.slice(0, built.indexOf("\nimport "));
      const pointer = path.posix.relative(path.posix.dirname(file), noticeFile);
      expect(banner).toContain("Ultracite");
      expect(banner).toContain("MIT");
      expect(banner).toContain(pointer);
      expect(files.has(noticeFile)).toBe(true);
    },
  );
});
