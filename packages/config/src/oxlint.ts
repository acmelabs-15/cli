// The ACMElabs lint preset. A repo's oxlint.config.ts, a thin caller, imports it.
import { defineConfig } from "oxlint";
import type { DummyRuleMap } from "oxlint";
import core from "ultracite/oxlint/core";

import type { Deviation } from "./deviation";
import { settingsOf } from "./deviation";

/** One rule's setting as oxlint types it, such as `"off"` or `["error", "type"]`. */
type RuleSetting = NonNullable<DummyRuleMap[string]>;

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

/** The rules in which the ACMElabs preset differs from Ultracite's core preset. */
export const lintDeviations = {
  "func-style": {
    setting: "off",
    reason:
      "Function declarations, with helpers above their callers: Ultracite's `no-use-before-define` requires that order.",
  },
  "sort-keys": {
    setting: "off",
    reason:
      "Object keys follow meaning, not the alphabet: a manifest's fields, a record's fields, a fixture tree's paths.",
  },
  "no-await-in-loop": {
    setting: "off",
    reason:
      "Steps that must run in order stay sequential: ordered writes, a check that finishes before the first write, one outside program at a time so outputs do not mix. `Promise.all` would reorder them.",
  },
  "typescript/consistent-type-definitions": {
    setting: ["error", "type"],
    reason: "ACMElabs code uses `type` for object shapes, as the specs' code style shows.",
  },
} satisfies Record<string, Deviation<RuleSetting>>;

/** The ACMElabs lint preset: Ultracite's core preset and the deviations above. */
export default defineConfig({
  extends: [core],
  // `extends` does not pass ignorePatterns on, so Ultracite's list is named here.
  ignorePatterns: ultraciteIgnorePatterns(),
  rules: settingsOf(lintDeviations),
});
