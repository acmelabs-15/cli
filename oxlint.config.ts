// Lint: Ultracite's Oxlint core preset, extended by hand, with brain's settings. The TypeScript
// compiler check stays a separate step, `bun run typecheck`. Every relaxation below is a decision
// with its reason; see brain's docs/decisions/DEC-001-lint-and-format.md. This config moves into
// @acmelabs/config with the config-presets module, and this repo then imports it from there.
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  // `extends` does not pass ignorePatterns on, so the preset's own list is named here.
  ignorePatterns: core.ignorePatterns,
  rules: {
    // Function declarations hoist, so a file reads top-down with helpers below their callers.
    "func-style": "off",
    // Object keys are ordered by meaning: a manifest's fields, a fixture tree's paths.
    "sort-keys": "off",
    // Steps that must run in order stay sequential: ordered writes, and a check that must finish
    // before the first write. Promise.all would reorder them.
    "no-await-in-loop": "off",
    // The spec's code style uses `type` for object shapes.
    "typescript/consistent-type-definitions": ["error", "type"],
  },
});
