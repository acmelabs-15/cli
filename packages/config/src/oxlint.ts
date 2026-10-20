// The ACMElabs lint preset. A repo's oxlint.config.ts, a thin caller, imports it.
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

/**
 * Ultracite's ignore list. Ultracite's type marks it optional, and its core preset always sets it.
 * As a `string[]`, the list lets a thin caller write `[...preset.ignorePatterns, "x"]`.
 */
function ultraciteIgnorePatterns(): string[] {
  if (core.ignorePatterns === undefined) {
    throw new Error("Ultracite's core preset has no ignorePatterns, so the lint preset has none");
  }
  return core.ignorePatterns;
}

/** The ACMElabs lint preset: Ultracite's core preset and four deviations. */
export default defineConfig({
  extends: [core],
  // `extends` does not pass ignorePatterns on, so Ultracite's list is named here.
  ignorePatterns: ultraciteIgnorePatterns(),
  rules: {
    // Function declarations, with helpers above their callers: Ultracite's no-use-before-define
    // requires that order.
    "func-style": "off",
    // Object keys follow meaning, not the alphabet: a manifest's fields, a record's fields, a
    // fixture tree's paths.
    "sort-keys": "off",
    // Steps that must run in order stay sequential: ordered writes, a check that finishes before
    // the first write, one outside program at a time so outputs do not mix. Promise.all would
    // reorder them.
    "no-await-in-loop": "off",
    // ACMElabs code uses `type` for object shapes, as the specs' code style shows.
    "typescript/consistent-type-definitions": ["error", "type"],
  },
});
