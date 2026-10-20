import { describe, expect, test } from "bun:test";

import { sameWords } from "../words";

describe("sameWords", () => {
  test("is true for the same words in the same order", () => {
    expect(sameWords(["gh", "auth", "status"], ["gh", "auth", "status"])).toBe(true);
    expect(sameWords([], [])).toBe(true);
  });

  test("is false for other words, another order, or another count of words", () => {
    expect(sameWords(["version", "sync"], ["version", "check"])).toBe(false);
    expect(sameWords(["auth", "gh"], ["gh", "auth"])).toBe(false);
    expect(sameWords(["gh", "auth"], ["gh", "auth", "status"])).toBe(false);
    expect(sameWords(["gh", "auth", "status"], ["gh", "auth"])).toBe(false);
  });
});
