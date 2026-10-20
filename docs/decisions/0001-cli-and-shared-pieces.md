# The CLI and shared pieces, with nothing copied into a repo

Decided by Peter on 2026-10-19 (spec interview, Q1).

ACMElabs repos stop carrying their own copies of the release machinery. One CLI, `acmelabs`, does the repo-level jobs (version sync, release notes, validate, marketplace entries, new repos), and the shared pieces (shared workflows in acmelabs-15/.github and presets in `@acmelabs/config`) hold the rest. A repo keeps only thin callers: workflow files that call the shared workflows, config files that import the presets, and `package.json` scripts that call `acmelabs`. The copies in brain, jev-gate and ask-user-question had already drifted, so a fix to the release flow had to be made by hand in each repo.

## Considered options

- **`acmelabs new` only, copying brain's files into each new repo.** Rejected: every new repo would be one more copy to fix by hand.
