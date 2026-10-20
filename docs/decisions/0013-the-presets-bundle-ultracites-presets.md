# The presets bundle Ultracite's presets

Decided by Peter on 2026-10-20 (module `config-presets`, the final-checkpoint review, finding 3).

`@acmelabs/config` bundles the two Ultracite presets it builds on, `ultracite/oxlint/core` and `ultracite/oxfmt`, into its built JavaScript. Ultracite becomes a devDependency of the package, so a repo that installs `@acmelabs/config` installs no Ultracite. Ultracite 7.12.0 is a whole CLI with 17 dependencies on caret ranges (`execa`, `commander`, `@clack/prompts` and others), and the presets use two of its config files. Bundling keeps that tree out of every ACMElabs repo, and out of any CI that runs on a pull request. The bundled presets still import `oxlint` and `oxfmt`, which each repo lists itself.

## Considered options

- **Ultracite as a dependency of the package.** Rejected: every repo installs Ultracite's CLI tree for two config files. Today's repos already install it, so this kept the exposure, not added it; the agent recommended deciding in `cli-release`, and Peter chose to bundle now.

## Consequences

- Ultracite is MIT. The package ships Ultracite's copyright and permission notice beside the bundled code.
- A bump of Ultracite is a rebuild and a new version of `@acmelabs/config`, as before. The deviation tests still compare each preset with Ultracite's, from the devDependency.
- The sample-repo tests prove the bundle stands alone: a sample repo has no Ultracite in its `node_modules`.
