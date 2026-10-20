# A new npm package starts with a placeholder version, then CI publishes directly

Decided by Peter on 2026-10-20 (spec interview, QA5 and QA6).

npm's trusted publishing cannot create a package, and a new trusted publisher expires after 48 hours unless CI publishes with it. So a new library package starts from Peter's machine: a stage publish creates the package with the public placeholder version `0.0.0-stage`, and the CLI then sets the trusted publisher, both with Peter's 2FA. The first real version, 0.1.0, publishes from CI with provenance when the first Version Packages PR merges. The trusted publisher allows direct publish, not only stage publish: the merge of the Version Packages PR is the human approval, so a release needs no second step. When the scope itself does not exist, the CLI opens npm's org-creation page and waits until the scope appears; only the npm website can create an org.

## Considered options

- **First version published by hand, as design-system did.** Rejected: that version has no provenance, and the trusted publisher expires before the next release unless it is set again.
- **Stage-only trusted publisher.** Rejected: every release would wait for a 2FA approval on npmjs.com.

## Consequences

- `@acmelabs/cli` and `@acmelabs/config` take the same path for their own first release.
- The first Version Packages PR must merge within 48 hours of the trusted publisher's creation.
- CI publishes with the npm CLI, because `bun publish` has no trusted publishing.
