// Format: Ultracite's Oxfmt preset with brain's two explicit deviations, stated here so they are
// decisions and not silent acceptance of the preset. See brain's
// docs/decisions/DEC-001-lint-and-format.md.
//   printWidth 100, not 80: plain TypeScript with long path strings; 80 wraps every template
//   literal.
//   trailingComma "all", not "es5": one convention across ACMElabs repos.
// The preset's own ignorePatterns come in with the spread. This config moves into @acmelabs/config
// with the config-presets module, and this repo then imports it from there.
import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  printWidth: 100,
  trailingComma: "all",
});
