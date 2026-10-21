# Git calls run without git's GIT_ variables

Decided by Peter on 2026-10-20 (module `github-ops`, during the build). Supersedes one sentence of ADR-0015 ("no variable is removed") for git calls only.

Every git program that acmelabs starts gets the environment without any variable whose name starts with `GIT_`. acmelabs then adds the variables it sets itself, such as `GIT_TERMINAL_PROMPT=0`, and names the repo's folder. A git hook exports variables such as `GIT_DIR`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR`, and so can other tools. With them set, a git call that acmelabs runs in one folder works in another repo: in a probe, `git merge-base` answered for the wrong repo, and a `git clone` wrote into another repo's index, so its staged changes were lost (`docs/research/12-git-and-github-packages.md`, sections 1.3 and 1.4). git's hook docs say that a tool which runs git elsewhere "should clear these environment variables"; git's own code does it (`sanitize_repo_env`), pre-commit does it (`no_git_env`), and simple-git 4.0.0 made it its default in 2026-09 as a security fix.

## Considered options

- **Flags: `--git-dir` and `--work-tree`.** Peter's first idea, and git's own mechanism for those two variables. Rejected: no flag covers `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, the object and config variables, so a clone can still damage another repo.
- **Only the 15 names of `git rev-parse --local-env-vars`.** Rejected: on git 2.54.0 the list misses `GIT_REFERENCE_BACKEND`, and `GIT_CONFIG_GLOBAL` can redirect a push; removing every `GIT_` name covered every probed case.
- **simple-git 4.0.2**, which clears the variables itself. Rejected: it starts git outside the World, so its calls skip the time and output limits and `fakeWorld`, and its raw call reads git's exit 1 as success.
- **No change.** Rejected by Peter as not robust.

## Consequences

- The World's spawn can remove a variable for a call. Every program other than git still gets the whole environment (ADR-0015).
- A `GIT_` setting that a person makes on purpose, such as `GIT_SSL_CAINFO` or `GIT_TRACE`, does not reach acmelabs's git calls. acmelabs pushes and clones over HTTPS with gh's login, so the SSH names do not apply.
- On git 2.54.0, `GIT_REFERENCE_BACKEND` is missing from git's own `local_repo_env[]` list; a report to git upstream is an outward-facing step for Peter to decide.
