# The gate runs on Bun, through `run.bun` in every repo's `bunfig.toml`

Decided by Peter on 2026-10-20 (module `config-presets`, open question 4).

Every ACMElabs repo has a `bunfig.toml` with `bun = true` in its `[run]` section. tsc, oxlint, oxfmt and changesets start with `#!/usr/bin/env node`, and `bun run` gives them a real Node whenever one is on PATH. So without the line, the gate ran on Node v24 on Peter's machine and would run on whatever Node a CI runner has. With it, Bun puts its own `node` first on PATH for every script and every program a script starts, so the gate runs on Bun everywhere (`docs/research/08-presets-in-a-consumer-repo.md`). Peter's condition: everything actually runs on Bun, not Node, and a test proves it with a `node` on PATH that fails when called.

## Considered options

- **`bun --bun run` in CI only.** Rejected: local runs would keep Node, so local and CI could differ.
- **No change.** Rejected: the Bun-only rule would hold in name only.

## Consequences

- `@acmelabs/config` cannot carry the line, because Bun reads `bunfig.toml` only from the repo. `scaffold` writes it into new repos, and `jev-gate-migration` adds it to jev-gate.
- A program started outside `bun run`, such as an editor's oxlint extension, still uses Node.
- Linux with Bun 1.4.0 is unverified; `shared-workflows` proves it in CI.
