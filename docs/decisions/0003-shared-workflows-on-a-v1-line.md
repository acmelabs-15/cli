# Repos follow the shared workflows on a moving v1 line

Decided by Peter on 2026-10-20 (spec interview, Q6).

Each ACMElabs repo calls the shared workflows as `acmelabs-15/.github/.github/workflows/<name>.yml@v1`. Each release of the shared workflows gets a fixed `v1.x.y` tag, and the plain git tag `v1` moves to it; a breaking change starts `v2`, and each repo opts in. A fix therefore lands once and reaches every repo on its next run, which is the goal of ADR-0001. GitHub's security guidance prefers a full commit SHA; that guidance protects a repo from a third party's workflow, and here ACMElabs is the author. The cost is that a bad `v1` release reaches every repo at once, so acmelabs-15/.github runs its own tests before each release.

## Considered options

- **A SHA per repo, updated by Dependabot.** Rejected: one fix means one PR to merge in every repo.
- **`@main`.** Rejected: no version to go back to.

## Consequences

- `v1` stays a plain git tag, never a GitHub release: an immutable release locks its tag, and `v1` must move.
- The shared workflows run each repo's own `package.json` scripts, so the CLI version comes from the repo's lockfile, not from the workflow line.
