# Library packages publish built JavaScript with type files

Decided by Peter on 2026-10-20 (spec interview, QA4).

Every library package, `@acmelabs/cli` and `@acmelabs/config` included, publishes JavaScript built with `bun build` plus `.d.ts` files built with `tsc`. Bun alone could run the TypeScript source, but Node cannot run TypeScript files inside `node_modules`, and oxlint and oxfmt load a TypeScript config through Node. That config imports the `@acmelabs/config` presets, so TypeScript-only presets would fail in every repo. Building on Bun keeps the Bun-only rule: no Node runtime ships. Each release tests the packed package before it publishes.
