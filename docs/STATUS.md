# Status — the handoff note

The one place for where the project stands. Every session reads it first and rewrites it last (see "Session end" in `AGENTS.md`). Keep it short: facts a new session needs to continue, nothing else.

**Updated:** 2026-10-20, during the `github-ops` build, after task 3 and two extra slices, by the Claude Code session that runs `/brain:build auto`.

## Where things stand

- **The spec:** the capability map of 16 modules is approved (`spec/README.md`). Every interview decision is recorded (`docs/design/spec-interview.md`, `docs/decisions/`).
- **Done and merged into main:** `repo-model` (PR #1, `082abe4`), `command-core` (PR #2, `38888fa`) and `config-presets` (PR #3, `7fcb916`). Their plans are in `tasks/done/`.
- **In progress: `github-ops`, on branch `github-ops`, in `/brain:build auto`.** Spec and plan approved. Tasks 1 to 3 of 13 are done (`tasks/todo.md`): the World's process groups, the time and output limits for programs, and the time and body limits for requests. `bun run check` is green on the branch: 275 tests.
- **Extra slices on the branch, not in the plan:** two fixes to the group stop (`586c53b`, `d278124`), the World split into five files (`e055fdf`: `world.ts`, `world-limits.ts`, `world-spawn.ts`, `world-fetch.ts`, `fake-world.ts`), and network failures of a request as outside failures, exit 3 (`c52a4df`).
- **The build order** (Peter, 2026-10-20, `tasks/plan.md`): tasks 4, 5, 8 and 9 one at a time; then 6, 7, 10, 12 and 13 at once, each agent in its own git worktree; then 11. Each task is built by a fresh sub-agent, which reviews its own diff on five axes; the orchestrator checks the gate and pushes.
- **Peter's choices during the build:** keep the repo's own command code rather than adopt execa, incur or ky (`docs/research/11-packages-for-the-command-runtime.md`); the World's `sleep` uses `setTimeout` from `node:timers/promises`.
- **The repo:** public at https://github.com/acmelabs-15/cli, main protected by "Protect main". Peter's standing permissions: commit at task and session ends, push after every commit, one branch per module merged through one PR; opening a PR and merging are asked.

## Red and notes

- **A machine crash on 2026-10-20** stopped task 3's agent mid-task; the work in the tree survived and the agent finished it. The crash also emptied the session scratchpad.
- **Flaky timing tests:** `repo-model`'s "10,000 package paths in under 100 ms" (132 ms once under load); `command-core`'s "spawn stops the program soon after its signal aborts" failed once in 200 runs under heavy load (cause UNVERIFIED).
- **Bun 1.4.0 faults seen in the build, candidates for upstream issues (filing them is asked first):** a segfault in a fetch test on the old code (`https://bun.report/1.4.0/Mt134cbb9aiDglooC+k7iW2sj9kB2445Gm+0okB2zpvmD2s+5M+3njDu0kjD2ot+B2p8iD242iD2i1iD+m+mKm4j9sBmjrra_mmj4mDmrovmDm/++MuvzjDA2AwphD`); `server.stop(true)` never resolves after a client's time-out and cancel; an async generator body keeps draining after a cancel.
- **For the final review of `github-ops`:** `redact.ts` misses some URL secrets (`?sig=`, `?code=`, `X-Amz-Credential`, a token in the path), and request messages now show whole URLs; a child that macOS is still creating misses the group SIGTERM, so such a cancel can take up to the 5-second grace (5 of 320 loaded runs; the spec's design kept).
- **This repo's root configs do not load under real Node** (an editor's oxc extension). Peter accepted this on 2026-10-20.
- **For `cli-release`:** open questions 23 and 24; the built JavaScript holds path comments with the install store's hash.
- **Open question 19 blocks `repo-checks`:** a parse error that quotes a linked `acmelabs.json` reaches JSON mode's lines.
- **For `shared-workflows`:** prove the World's process groups, limits and network-failure codes on Linux in CI, beside `run.bun`.
- **For `scaffold`:** the GitHub timing right after a repo is created is UNVERIFIED (`github-ops` spec open question 1); open question 6 (which plugin's skill runs on a shared name).
- **npm:** the local npm login is rejected (401). The first publishes need Peter's `npm login` and 2FA, in module `cli-release`.

## Waiting on Peter

Nothing blocks. Opening the PR and merging it are asked at the module's last checkpoint.

## Next steps

1. `github-ops` task 4: the World can wait, and a fake World waits in no time. Then the checkpoint "the World's limits", then tasks 5, 8, 9, the parallel batch, and 11.
2. After `github-ops`: the other layer 1 spec, `npm-ops`. `tui-kit` waits for its prototype (open question 3).
