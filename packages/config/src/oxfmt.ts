// The ACMElabs format preset. A repo's oxfmt.config.ts, a thin caller, imports it.
import { defineConfig } from "oxfmt";
import type { OxfmtConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

import type { Deviation } from "./deviation";
import { settingsOf } from "./deviation";

/**
 * Ultracite's ignore list. Ultracite's type marks it optional, and its oxfmt preset always sets it.
 * As a `string[]`, the list lets a thin caller write `[...preset.ignorePatterns, "x"]`.
 */
function ultraciteIgnorePatterns(): string[] {
  if (ultracite.ignorePatterns === undefined) {
    throw new Error(
      "Ultracite's oxfmt preset has no ignorePatterns, so the format preset has none",
    );
  }
  return ultracite.ignorePatterns;
}

/**
 * The options in which the ACMElabs preset differs from Ultracite's oxfmt preset. Each setting
 * keeps its own option's type, so `"all"` stays a trailing-comma setting, not a `string`.
 */
export const formatDeviations = {
  printWidth: {
    setting: 100,
    reason:
      "Plain TypeScript with long paths and messages: at 80 columns, every template literal wraps.",
  },
  trailingComma: {
    setting: "all",
    reason: "One convention across ACMElabs repos.",
  },
} satisfies { [Option in keyof OxfmtConfig]?: Deviation<OxfmtConfig[Option]> };

/** The ACMElabs format preset: Ultracite's oxfmt preset and the deviations above. */
export default defineConfig({
  // oxfmt has no `extends`, so Ultracite's options are spread.
  ...ultracite,
  // Named again, so the preset's type says the list is always present.
  ignorePatterns: ultraciteIgnorePatterns(),
  ...settingsOf(formatDeviations),
});
