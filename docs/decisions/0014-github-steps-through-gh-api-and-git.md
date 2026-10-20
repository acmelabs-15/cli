# GitHub steps run through gh api, and git with gh's login

Decided by Peter on 2026-10-20 (module `github-ops`).

Every GitHub REST call that acmelabs makes runs `gh api` with a JSON body, and every push and clone runs git with gh's credential helper, as gh does for its own git calls. One login, gh's, covers the API calls and the push: the keyring on a maintainer's machine, or `GH_TOKEN` in CI. acmelabs never holds a token, so no token can reach its output (`docs/research/09-github-steps.md`).

## Considered options

- **fetch with a token** from `GH_TOKEN` or `gh auth token`. Rejected: acmelabs would hold the token, and the redaction would have to cover a token that is not in the environment. gh would still be needed for the token on a maintainer's machine.
- **gh's high-level commands** (`gh repo create`, `gh pr create`, `gh run watch`). Rejected: they print text, not JSON, and the text can change between gh versions; `gh run watch` polls every 3 seconds, about 2,400 requests per hour of the 5,000-per-hour limit.

## Consequences

- gh must be installed; without it a step ends with exit 3 and names gh.
- Each call starts one gh process, about 0.3 seconds on Peter's Mac (`docs/research/10-outside-program-limits.md`, section 7).
- Tests script each call as a command line through `fakeWorld`.
