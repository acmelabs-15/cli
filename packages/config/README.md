# @acmelabs/config

`@acmelabs/config` holds the ACMElabs presets: the shared configs for oxlint, oxfmt and TypeScript. An ACMElabs repo uses them through thin callers, small files that import a preset instead of copying it. The lint and format presets start from [Ultracite](https://github.com/haydenbleasel/ultracite)'s presets. Each deviation from Ultracite is kept in the package with its reason, and the tables below list them all.

**Status:** in development. The package is not on npm yet, so there is nothing to install. The `cli-release` module publishes it.

## Install

A repo lists the package and four tools in its `package.json`:

```json
{
  "devDependencies": {
    "@acmelabs/config": "<exact version>",
    "oxlint": "1.83.0",
    "oxfmt": "0.68.0",
    "typescript": "^5.6.0",
    "@types/bun": "^1.3.14"
  }
}
```

- Pin `@acmelabs/config` to one exact version. An upgrade then bumps one line.
- The repo lists `oxlint`, `oxfmt`, `typescript` and `@types/bun` itself, at these versions. They are peer dependencies of the package. With Bun's isolated linker, which Bun uses for a workspace, a dependency's own dependencies give the repo no `oxlint` or `oxfmt` command.
- `oxlint` and `oxfmt` are exact, because the deviations name the rules and options of those versions.
- The repo does not list `ultracite`. It is a dependency of the package.

The repo's `lint`, `format:check` and `typecheck` scripts stay as they are.

## Thin callers

A repo keeps these files. Each one passes the format check as written.

### Lint and format, when the repo adds nothing

`oxlint.config.ts`:

```ts
// Lint: the ACMElabs preset. Its deviations and their reasons: the @acmelabs/config README.
export { default } from "@acmelabs/config/oxlint";
```

`oxfmt.config.ts`:

```ts
// Format: the ACMElabs preset. Its deviations and their reasons: the @acmelabs/config README.
export { default } from "@acmelabs/config/oxfmt";
```

### Lint and format, when the repo adds its own settings

Each addition carries its reason, as the preset's deviations do. This example adds a vendored folder, `skills`, to the ignore list.

`oxlint.config.ts`:

```ts
import preset from "@acmelabs/config/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [preset],
  // `extends` does not pass ignorePatterns on, so the preset's list is named again.
  // Vendored skills are never linted or formatted by this repo.
  ignorePatterns: [...preset.ignorePatterns, "skills"],
});
```

`oxfmt.config.ts`:

```ts
import preset from "@acmelabs/config/oxfmt";
import { defineConfig } from "oxfmt";

export default defineConfig({
  ...preset,
  // Vendored skills are never linted or formatted by this repo.
  ignorePatterns: [...preset.ignorePatterns, "skills"],
});
```

The preset types say that `ignorePatterns` is always present, so a thin caller needs no fallback.

### TypeScript

`tsconfig.json`:

```json
{
  "extends": "@acmelabs/config/tsconfig.json",
  "include": ["src/**/*.ts"]
}
```

The preset sets no `include`. A path in an extended config resolves from the preset's own folder, so each repo names its own folders.

### Bun

`bunfig.toml`:

```toml
[run]
# The gate runs on Bun, also when Node is on PATH (ADR-0012).
bun = true
```

With `bun = true`, every check in the gate runs on Bun, also on a machine with Node on PATH. The package cannot carry this line, because Bun reads `bunfig.toml` only from the repo. The reasons are in [ADR-0012](https://github.com/acmelabs-15/cli/blob/main/docs/decisions/0012-the-gate-runs-on-bun.md).

## Deviations from Ultracite

### Lint: `@acmelabs/config/oxlint`

Ultracite's core preset through `extends`, with Ultracite's ignore list named again, because `extends` does not pass `ignorePatterns` on. Four rules differ:

| Rule | Ultracite | The preset | Reason |
| --- | --- | --- | --- |
| `func-style` | `expression` | `off` | Function declarations, with helpers above their callers: Ultracite's `no-use-before-define` requires that order. |
| `sort-keys` | `error` | `off` | Object keys follow meaning, not the alphabet: a manifest's fields, a record's fields, a fixture tree's paths. |
| `no-await-in-loop` | `error` | `off` | Steps that must run in order stay sequential: ordered writes, a check that finishes before the first write, one outside program at a time so outputs do not mix. `Promise.all` would reorder them. |
| `typescript/consistent-type-definitions` | `interface` | `type` | ACMElabs code uses `type` for object shapes, as the specs' code style shows. |

Ultracite's core preset also sets `env: { browser: true }`, which `extends` does not pass on. The preset sets no `env`.

### Format: `@acmelabs/config/oxfmt`

Ultracite's oxfmt preset, spread, because oxfmt has no `extends`. Two options differ:

| Option | Ultracite | The preset | Reason |
| --- | --- | --- | --- |
| `printWidth` | 80 | 100 | Plain TypeScript with long paths and messages: at 80 columns, every template literal wraps. |
| `trailingComma` | `"es5"` | `"all"` | One convention across ACMElabs repos. |

## TypeScript: `@acmelabs/config/tsconfig.json`

No upstream preset exists for TypeScript, so every option is a choice. Each option has a comment with its reason in the file:

| Option | Value | Reason |
| --- | --- | --- |
| `target` | `ESNext` | Bun runs the newest syntax; nothing is compiled down. |
| `module`, `moduleResolution` | `ESNext`, `bundler` | Resolve imports as Bun does: package exports, and no file extensions. |
| `lib` | `["ESNext"]` | No DOM: the code runs on Bun, not in a browser. |
| `types` | `["bun"]` | Bun's globals and APIs. The repo installs `@types/bun`. |
| `strict` | `true` | Every strict check. |
| `noUncheckedIndexedAccess` | `true` | An index read can be `undefined`, and the type says so. |
| `noEmit` | `true` | `tsc` only checks; Bun runs the source. A library build sets its own output. |
| `skipLibCheck` | `true` | Dependencies' type files are not checked: faster, and not this repo's to fix. |
| `verbatimModuleSyntax` | `true` | A type-only import says `type`, so a transpiler drops it without type information. |

## Editors

The built presets load under Node too, so an editor's oxlint or oxfmt extension reads the same rules.

## Records

The package is built in [acmelabs-15/cli](https://github.com/acmelabs-15/cli). Its records there:

| For | Read |
| --- | --- |
| What the package does, and its tests | [`spec/SPEC-config-presets.md`](https://github.com/acmelabs-15/cli/blob/main/spec/SPEC-config-presets.md) |
| Why the presets are their own package | [ADR-0004](https://github.com/acmelabs-15/cli/blob/main/docs/decisions/0004-npm-packages-cli-and-config.md) |
| Why the package ships built JavaScript | [ADR-0005](https://github.com/acmelabs-15/cli/blob/main/docs/decisions/0005-libraries-publish-built-javascript.md) |
| Why the gate runs on Bun | [ADR-0012](https://github.com/acmelabs-15/cli/blob/main/docs/decisions/0012-the-gate-runs-on-bun.md) |
