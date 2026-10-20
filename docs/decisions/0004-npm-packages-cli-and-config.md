# The CLI and the presets ship as two npm packages from one repo

Decided by Peter on 2026-10-20 (spec interview, Q2a, Q2b, Q2c).

The CLI ships on npm as `@acmelabs/cli`, and the presets ship as a separate package, `@acmelabs/config`. Both live in this repo as a Bun workspace. Each ACMElabs repo pins both as exact devDependencies. Peter owns the `@acmelabs` npm org, which already publishes `@acmelabs/design-system`; both names were free on 2026-10-20. The agent recommended the presets inside `@acmelabs/cli` for one pin and one release; Peter chose a separate package so the presets version on their own.

## Considered options

- **A GitHub dependency (`github:acmelabs-15/cli#v0.1.0`).** Rejected: Bun resolves exact tags only, with no version ranges.
- **A compiled single-file binary on GitHub releases.** Rejected: about 64 MB per platform, macOS signing work, and `package.json` cannot pin it.
- **A `create-acmelabs` package for `bun create acmelabs`.** Deferred to a later pass: a third package for a shorter start command.
