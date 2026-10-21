# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, after the merge of PR #4 (`github-ops`), by the Claude Code session that merged it at Peter's choice.

## Where things stand

- **The spec:** the capability map of 16 modules is approved (`spec/README.md`). Every interview decision is recorded (`docs/design/spec-interview.md`, `docs/decisions/`).
- **Done and merged into main:** `repo-model` (PR #1, `082abe4`), `command-core` (PR #2, `38888fa`), `config-presets` (PR #3, `7fcb916`) and `github-ops` (PR #4, `7a875ae`). Their plans are in `tasks/done/`. `bun run check` is green on `main` after the merge: 653 tests at `7a875ae`.
- **What `github-ops` holds:** the World's limits (5 minutes per program, 1 minute per request, 10 MB per output or body), a process group per program, network failures as exit 3, `sleep` with a fake clock, and git calls without the `GIT_` variables (ADR-0015, ADR-0016); the GitHub steps in `packages/cli/src/github/` (`checkLogin`, `ensureRepo`, `ensureActionsSetting`, `ensureProtectMain`, `push`, `clone`, `openPullRequest`, `watchRun`, `findTag`), each safe to run again. No command uses them yet: `scaffold` and `marketplace-add` will.
- **No module is in progress.** `tasks/plan.md` and `tasks/todo.md` do not exist until the next module's plan.
- **The repo:** public at https://github.com/acmelabs-15/cli, main protected by "Protect main". The module branches stay on the remote after their merge. Peter's standing permissions: commit at task and session ends, push after every commit, one branch per module merged through one PR; opening a PR and merging are asked.

## Red and notes

- **Optional review findings left open from `github-ops`:** the test suite takes about 13 s (up from 3 s); a folder that is not a git repo ends with exit 3 in `push`; `loginNeeded` has two forms.
- **Flaky timing tests:** `repo-model`'s "10,000 package paths in under 100 ms" (132 ms once under load); `command-core`'s "spawn stops the program soon after its signal aborts" failed once in 200 runs under heavy load (cause UNVERIFIED).
- **Bun 1.4.0 faults seen in the `github-ops` build, candidates for upstream issues (filing is asked first):** a segfault in a fetch test on old code; `server.stop(true)` never resolves after a client's time-out and cancel; an async generator body keeps draining after a cancel.
- **git upstream, Peter's call:** `GIT_REFERENCE_BACKEND` is missing from git 2.54.0's own list of local variables (note 12).
- **For later modules:** open question 25 (`marketplace-add`: where it clones); open question 19 blocks `repo-checks`; `shared-workflows` proves the World's process groups, limits and network-failure codes on Linux, beside `run.bun`; `scaffold`'s acceptance run proves GitHub's timing right after a create (`github-ops` spec open question 1) and decides open question 6; `cli-frontend` turns Ctrl+C into the run's cancel (a program in its own process group does not get the terminal's Ctrl+C) and may give `acmelabs` a folder flag.
- **This repo's root configs do not load under real Node** (an editor's oxc extension); accepted by Peter.
- **For `cli-release`:** open questions 23 and 24; the local npm login is rejected (401), so the first publishes need Peter's `npm login` and 2FA.
- **Two stray 1-byte files** from review agents sit outside the repo, at `/private/tmp/claude-501/-Users-peterkloss/Dev/ACMElabs/cli/placeholder` and `/private/tmp/claude-501/-Users-peterkloss/-Dev-ACMElabs-cli/placeholder`. Their deletion was denied to the agents; Peter removes them if he wants.

## Waiting on Peter

Nothing now. The `npm-ops` spec asks Peter its decisions one at a time, and stops for his approval when it is written.

## Next steps

1. The other layer 1 spec: `npm-ops`, through `/brain:spec`. **STOP** for Peter's approval when `spec/SPEC-npm-ops.md` is written.
2. `tui-kit` waits for its prototype (open question 3).
