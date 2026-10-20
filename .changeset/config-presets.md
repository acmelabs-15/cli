---
"@acmelabs/config": minor
---

First version of the package: the ACMElabs presets for oxlint (`@acmelabs/config/oxlint`), oxfmt (`@acmelabs/config/oxfmt`) and TypeScript (`@acmelabs/config/tsconfig.json`). A repo imports each preset through a thin caller instead of copying the config, so a fix to the shared rules reaches the repo with one version bump. The lint and format presets start from Ultracite's, and the README lists each deviation with its reason. The package bundles Ultracite's two presets, with Ultracite's MIT notice, so a repo installs no Ultracite; the repo lists `oxlint` 1.83.0, `oxfmt` 0.68.0, `typescript` and `@types/bun` itself.
