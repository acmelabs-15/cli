# Implementation plan — github-ops

Status: **approved by Peter on 2026-10-20** through the three plan questions (size right, edges right, no merge or split). Written from `spec/SPEC-github-ops.md`, approved on 2026-10-20. Words follow `CONTEXT.md`. The task details, with acceptance criteria and checks, are in `tasks/todo.md`.

## Overview

`github-ops` gives the later commands the GitHub steps (check the gh login, create or reuse a repo, the Actions setting, Protect main, push, clone, open a PR, watch a run, read a tag), each one safe to run again. It also gives the World the limits that Peter chose: 5 minutes per program, 1 minute per request, 10 MB per output, with every program in its own process group. Thirteen tasks, each a vertical slice that leaves `bun run check` green, built on branch `github-ops` and merged into `main` through one PR.

| Phase | Tasks | Ends at |
|---|---|---|
| 1. The World's limits | 1–4 | Checkpoint: every World criterion of the spec passes |
| 2. The tracer and the settings | 5–9 | Checkpoint: the Actions setting and Protect main pass every case, and a re-run writes nothing |
| 3. The other steps | 10–13 | Checkpoint: every success criterion of the spec passes; `/brain:review`; PR into `main` |

## Architecture decisions

The spec settles the steps, the limits and the seams. These are the plan's own calls; each is small and reversible.

| Decision | Reason |
|---|---|
| Task 1 is the process group and the time limit for programs. | It is the riskiest change: Bun's own `timeout` and `kill` reach only the direct child (note 10, section 2). If the group kill fails on Bun, the plan learns it first. The spec's later World changes build on its kill path. |
| Each limit task adds its `fakeWorld` answer (`limit: "time"` or `limit: "output"`) with the same failure as the real one. | A step's test can then script a limit, and the fake cannot drift from the real failure's message. |
| `realWorld` takes an optional SIGKILL grace (the spec's call), and the tests use 200 ms. | A test of a program that ignores SIGTERM then takes 0.2 s, not 5 s. |
| Task 5 is the tracer: the Actions setting through `ghApi`. | It is the smallest step that runs the whole path: the name check, a `gh api` GET and PUT, the answers-to-failure table, a progress step, and "skipped" on a re-run. Every later step reuses that path. |
| A shared test helper builds `gh api` command lines and scripted answers from the real bodies in note 09. | Every step's test scripts the same command line shape, and the answers stay true to GitHub's. |
| `git.ts` starts in task 10 with the local-history check, and grows in task 11 with push and clone. | Each task adds only the command lines its step needs. One test runs the local-history check against a real git repo in a temp folder: no network, and it proves the command line, which a script cannot. |
| One changeset, `.changeset/outside-program-limits.md`, starts in task 1 and grows in tasks 2 and 3. | The limits change what every later command does at a limit (exit 3). The GitHub steps get no changeset: no command uses them until `scaffold` and `marketplace-add`, which record them. |
| Each World task updates the World section of `spec/SPEC-command-core.md`. | The spec stays alive beside the code it describes. |
| No probe of GitHub in this module. | The steps retry an unexpected 404 or 409 (task 9), and `scaffold`'s acceptance run proves the real sequence (spec open question 1). A probe would leave a repo that the gh login cannot delete. |

## Order of work

```
1 A program runs in its own process group, under a time limit
└── 2 A program's output stops at its output limit
3 A request stops at its time limit and its body limit
4 The World can wait, and a fake World waits in no time
5 Tracer: a sample command gives a repo the Actions setting   (needs 1)
├── 6 checkLogin names the gh command that fixes the login
├── 7 A command file may check a repo name at its top
├── 8 Every repo can get Protect main
├── 9 A step retries an unexpected 404 or 409                  (also needs 4)
├── 10 ensureRepo creates a repo, or reuses only this run's repo
│   └── 11 push and clone through gh's login
├── 12 openPullRequest reuses an open PR or opens one
└── 13 watchRun waits for a run, and findTag reads a tag       (also needs 4)
```

Tasks 1, 3 and 4 need nothing, but they change the same file (`world.ts`), so they run one after another in that order. Tasks 6, 7, 8, 10, 12 and 13 need only task 5 (and task 13 also task 4), so they can run in parallel on separate files, apart from 8, which shares `settings.ts` with 5 and 9.

**The build order, Peter's choice on 2026-10-20:** tasks 1 to 5, 8 and 9 run one at a time. Then tasks 6, 7, 10, 12 and 13 run at once, each agent in its own git worktree, after task 9, because task 9 changes how every step calls `ghApi`. The orchestrator merges each finished task into `github-ops`, ticks its boxes in `tasks/todo.md`, and runs the gate after each merge. Task 11 runs once task 10 is merged.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The group kill (`detached: true`, `kill(-pid)`) behaves on Bun 1.4.0 other than note 10's probes showed | High | Task 1 first, with a test for a child that holds the pipe, one that ignores SIGTERM, and a cancel. |
| The process groups behave differently on Linux | Medium | The spec leaves it UNVERIFIED; `shared-workflows` proves it in CI (spec open question 3). |
| A scripted gh answer differs from GitHub's real one | Medium | The helper copies the real bodies from note 09; `scaffold`'s acceptance run meets the real GitHub. |
| Tests that time real programs fail under load, as `repo-model`'s 100 ms test did | Medium | Each test asserts a generous upper bound (2 s), never a tight wall-clock limit. |
| The existing World test "fetch is the global fetch" breaks when fetch gets its limits | Low | Task 3 changes that test to the new contract: the World's fetch is a function with limits. |
| The answers-to-failure table hides an acmelabs bug as an outside failure ("any other answer") | Low | The message names the method, the path and GitHub's message, so a report shows the call. |

## Open questions

None block this plan. Spec open questions 1 to 5 stay open; none needs an answer before the build, and open question 1 is answered by `scaffold`'s acceptance run.
