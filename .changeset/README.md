# Changesets and releases

This repo keeps its changelogs with changesets, as acmelabs-15/brain does. It is both a library repo and a plugin repo (ADR-0010), so it runs two release flows: the library flow for the npm packages, and the plugin flow for the agent-guide plugin.

## When a change gets a changeset

A user-facing change gets a changeset.

1. Run `bun run changeset`.
2. Answer the prompts: the packages that the change touches, the bump for each package, and a one-line summary for the changelog.
3. Commit the new file in `.changeset/` with the change.

## The two release flows

Both flows start the same way. On a push to main with pending changesets, the release workflow opens the Version Packages PR. That PR bumps the version of each changed package and writes its `CHANGELOG.md`. Merging it is the human approval of a release.

| Release flow | What it releases | What happens after the Version Packages PR merges |
|---|---|---|
| Library flow | `@acmelabs/cli` and `@acmelabs/config` | CI publishes each new version to npm, with provenance, through the package's trusted publisher. |
| Plugin flow | The agent-guide plugin | CI cuts the release tag `v<version>` and moves the latest tag to the same commit. A pre-release version, one with a hyphen, does not move the latest tag. The marketplace entry follows the latest tag, so a release reaches installed users when the latest tag moves. |

A package's first release follows ADR-0006. The placeholder version `0.0.0-stage` creates the package on npm, and then the trusted publisher is set, both with Peter's 2FA. The first Version Packages PR then publishes 0.1.0 from CI.

## Today

The release workflow arrives with the `shared-workflows` module, and this repo starts to use it in the `cli-release` module. Until then, changesets only collects changes and versions them. Nothing opens a Version Packages PR, publishes to npm, or moves a tag.

| Command | What it does |
|---|---|
| `bun run changeset` | Adds a changeset. |
| `bun run changeset status` | Lists the pending changesets and the bump that each one makes. |
| `bun run version` | Runs `changeset version`: it applies the pending changesets to each package's version and `CHANGELOG.md`, and deletes them. It needs a `GITHUB_TOKEN`, because `@changesets/changelog-github` reads each change's PR and author from GitHub. The release workflow runs it inside the Version Packages PR. When the `repo-checks` module lands, it also runs the version sync, so every manifest agrees. |

Other facts for now:

- Each package stays `"private": true` until the `cli-release` module. `privatePackages.version` in `config.json` lets changesets version a private package. The `cli-release` module revisits `access` before the first publish.
- The agent-guide plugin arrives with the `agent-guide` module.
- Where the plugin's version and changelog live is open question 11 in `spec/README.md`.
