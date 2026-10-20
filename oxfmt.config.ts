// Format: the ACMElabs preset. Its deviations and their reasons: packages/config/src/oxfmt.ts.
// This repo imports the preset's source by relative path, not the built package: Bun runs the
// source with no build, so the gate needs no build step. The $schema line in acmelabs.json points
// at this repo's own source the same way.
export { default } from "./packages/config/src/oxfmt";
