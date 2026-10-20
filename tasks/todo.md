# Tasks — github-ops

The task list for `tasks/plan.md`. Tick a task in the checklist, and each box inside its section, when it meets its acceptance criteria and the Definition of Done (brain's `references/definition-of-done.md`). Each task ends with `bun run check` green, read from its own exit code, and one commit on branch `github-ops`, pushed.

"Through a sample command" means: a test defines a sample command that calls the step, runs it through `runCommand` with `fakeWorld`, and checks the outcome and its exit code, the progress updates, and the exact calls in `world.calls`. No test calls GitHub.

## Checklist

Phase 1 The World's limits

- [x] 1. A program runs in its own process group, under a time limit
- [x] 2. A program's output stops at its output limit
- [x] 3. A request stops at its time limit and its body limit
- [x] 4. The World can wait, and a fake World waits in no time
- [x] Checkpoint: the World's limits

Phase 2 The tracer and the settings

- [x] 5. Tracer: a sample command gives a repo the Actions setting
- [ ] 6. checkLogin names the gh command that fixes the login
- [ ] 7. A command file may check a repo name at its top
- [x] 8. Every repo can get Protect main
- [x] 9. A step retries an unexpected 404 or 409
- [ ] Checkpoint: the tracer and the settings

Phase 3 The other steps

- [ ] 10. ensureRepo creates a repo, or reuses only this run's repo
- [ ] 11. push and clone through gh's login
- [ ] 12. openPullRequest reuses an open PR or opens one
- [ ] 13. watchRun waits for a run, and findTag reads a tag
- [ ] Checkpoint: github-ops complete

## Task 1: A program runs in its own process group, under a time limit

**Description:** `realWorld`'s spawn starts each program in its own process group (`detached: true`) and adds the call's `env` to the whole environment. At the time limit (`limits.programMs`, 5 minutes, unless the call sets `timeoutMs`) and on a cancel, it sends SIGTERM to the whole group, then SIGKILL after the grace (5 s; `realWorld({ graceMs })` changes it for tests). A group that is already gone is not an error. A time limit rejects with an outside failure that names the program and the limit; a cancel rejects with the signal's reason, as today. `fakeWorld` scripts `limit: "time"` with the same failure, and its log shows `env` and `timeoutMs`. The task also starts the changeset and updates the World section of `spec/SPEC-command-core.md`.

**Acceptance criteria:**
- [x] A `bun -e` program past a 200 ms limit is stopped, and the call rejects with kind `outside` and a message that names the program and the limit; with the limit raised, the same program finishes with its output.
- [x] `bash -c "(sleep 2; echo late) & sleep 10"` ends, with its child, in under 2 s at a time limit and on a cancel; a program that ignores SIGTERM is killed after the grace; the existing cancel and pid-file tests still pass.
- [x] The call's `env` reaches the program beside the whole environment; `fakeWorld`'s `limit: "time"` rejects with the same failure as the real one, and its log shows `env` and `timeoutMs`.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** None

**Files likely touched:** `packages/cli/src/command/world.ts`, `packages/cli/src/command/__tests__/world.test.ts`, `.changeset/outside-program-limits.md`, `spec/SPEC-command-core.md`

**Estimated scope:** Medium

## Task 2: A program's output stops at its output limit

**Description:** spawn reads stdout and stderr with a reader that counts bytes, each stream on its own. Past the limit (`limits.outputBytes`, 10 MB, unless the call sets `maxOutputBytes`), it stops the group as task 1 does and rejects with an outside failure that names the program, the stream and the limit. `fakeWorld` scripts `limit: "output"` with the same failure.

**Acceptance criteria:**
- [x] A program that prints past a 1 MiB limit on stdout, and one that does so on stderr, is stopped in under 2 s, and the call rejects with kind `outside` naming the stream and the limit.
- [x] With the limit raised, the call keeps all the output; the existing output tests still pass.
- [x] `fakeWorld`'s `limit: "output"` rejects with the same failure as the real one.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** 1

**Files likely touched:** `packages/cli/src/command/world.ts`, `packages/cli/src/command/__tests__/world.test.ts`, `.changeset/outside-program-limits.md`, `spec/SPEC-command-core.md`

**Estimated scope:** Small

## Task 3: A request stops at its time limit and its body limit

**Description:** The World's `fetch` becomes a plain function type that takes `FetchInit` (`timeoutMs`, `maxBodyBytes`). `realWorld`'s fetch adds `AbortSignal.timeout` (`limits.requestMs`, 1 minute) beside the call's own signal, to the end of the body. A `Content-Length` above the body limit (10 MB) fails before the body is read; a reader that counts bytes stops any other body at the limit. A time-out and an over-limit body reject as outside failures that name the method, the URL and the limit; a cancel stays a cancel. `run.ts` stops copying Bun's `preconnect`. `fakeWorld`'s fetch scripts `limit: "time"` and `limit: "output"`.

**Acceptance criteria:**
- [x] Against a local `Bun.serve` server: slow headers and a slow body each fail at a 300 ms limit with kind `outside`; a cancel rejects with the cancel's reason, not a time-out.
- [x] A body whose `Content-Length` is above the limit fails without being read; an endless chunked body stops at the limit; a body under the limit reads whole.
- [x] `fakeWorld`'s fetch `limit` answers reject the same way, and `runCommand` still gives fetch the run's signal.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** None (after task 2 by order: the same file)

**Files likely touched:** `packages/cli/src/command/world.ts`, `packages/cli/src/command/run.ts`, `packages/cli/src/command/__tests__/world.test.ts`, `packages/cli/src/command/__tests__/run.test.ts`, `.changeset/outside-program-limits.md`

**Estimated scope:** Medium

## Task 4: The World can wait, and a fake World waits in no time

**Description:** The World gains `sleep(ms, { signal })`. `realWorld` waits with `setTimeout` from `node:timers/promises`, which takes the signal (note 11, Peter's choice to keep our code on 2026-10-20), and rejects with the signal's reason on a cancel. The context's `sleep` takes the run's signal, as `spawn` and `fetch` do. `fakeWorld`'s `sleep` moves its clock by `ms` at once, logs `{ kind: "sleep", ms }`, and rejects when its signal is aborted.

**Acceptance criteria:**
- [x] `realWorld`'s sleep waits about `ms`; with an aborted signal it rejects with the reason in a few milliseconds.
- [x] A sample command that sleeps 30 minutes through `fakeWorld` ends at once, `now()` then reads 30 minutes later, and `calls` logs the sleep.
- [x] A cancel during a sleep in the context ends the command with exit 130.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** None (after task 3 by order: the same files)

**Files likely touched:** `packages/cli/src/command/world.ts`, `packages/cli/src/command/fake-world.ts`, `packages/cli/src/command/run.ts`, `packages/cli/src/command/__tests__/world.test.ts`, `packages/cli/src/command/__tests__/fake-world.test.ts`, `packages/cli/src/command/__tests__/run.test.ts`, `spec/SPEC-command-core.md` (the World is split into five files since `e055fdf`)

**Estimated scope:** Small

## Checkpoint: the World's limits

- [x] `bun run check` is green: 288 tests at `d0e14f1`.
- [x] The spec's World criteria pass: the defaults are 5 minutes, 1 minute and 10 MB, a call can raise and lower each, and a program and the programs it started stop at a limit and on a cancel.
- [x] The World section of `spec/SPEC-command-core.md` matches the code.

## Task 5: Tracer — a sample command gives a repo the Actions setting

**Description:** The whole GitHub path, for one step. `names.ts`: `ownerSchema`, `repoNameSchema` and `GitHubRepo`. `gh.ts`: `ghApi`, which builds the spec's `gh api` command line (host, method, the two headers, the JSON body on stdin, `GH_PROMPT_DISABLED=1` and `GH_NO_UPDATE_NOTIFIER=1`) and reads the answer; `StepContext`; and the spec's answers-to-failure table. `settings.ts`: `actionsSetting` and `ensureActionsSetting`. A shared test helper builds `gh api` command lines and scripted answers from the real bodies in note 09.

**Acceptance criteria:**
- [x] Through a sample command: a repo that has the setting gives a skipped step and only the GET; a repo with another setting gets a PUT with the body and a done step; a 409 ends with exit 1 and names the organization's Actions settings page.
- [x] Through a sample command that calls `ghApi`: gh's exit 4 and a 401 end with exit 4 naming `gh auth login`; a 404 ends with exit 2 naming the repo; a rate-limit answer, a 5xx, an answer that is not JSON, and gh not installed each end with exit 3.
- [x] An owner or repo name that fails the name check ends with exit 2 before any call.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/github`
- [x] `bun run check` is green.

**Dependencies:** 1

**Files likely touched:** `packages/cli/src/github/names.ts`, `packages/cli/src/github/gh.ts`, `packages/cli/src/github/settings.ts`, `packages/cli/src/github/__tests__/gh-answers.ts`, `packages/cli/src/github/__tests__/gh.test.ts`, `packages/cli/src/github/__tests__/settings.test.ts`

**Estimated scope:** Medium (three source files, three test files)

## Task 6: checkLogin names the gh command that fixes the login

**Description:** `checkLogin` runs `gh auth status --hostname github.com --json hosts` and checks the active account's state and, for a token that reports scopes, the asked scopes. It uses `loginNeeded(service, fix)`, whose second argument task 5 added (`95eb913`), and `ghLogin` from `gh.ts`.

**Acceptance criteria:**
- [ ] Through a sample command: logged in with `repo` and `workflow` gives a done step with the login and scopes; a token that reports no scopes passes.
- [ ] No account, or a state of `error`, ends with exit 4 naming `gh auth login`; a missing `workflow` ends with exit 4 naming `gh auth refresh -h github.com -s workflow`.
- [ ] `loginNeeded` with one argument keeps today's message (tested since task 5).

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/github packages/cli/src/command`
- [ ] `bun run check` is green.

**Dependencies:** 5

**Files likely touched:** `packages/cli/src/github/login.ts`, `packages/cli/src/github/__tests__/login.test.ts`

**Estimated scope:** Small

## Task 7: A command file may check a repo name at its top

**Description:** The command list's import rule lets a command file load `../github/names` at its top, because that file loads only zod and a command's input checks a repo name with it. Every other github-ops file stays heavy.

**Acceptance criteria:**
- [ ] `heavyImports` of a command file that imports `../github/names` is empty; one that imports `../github/gh` still names it.
- [ ] A test scans `names.ts` and finds zod as its only import.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/command`
- [ ] `bun run check` is green.

**Dependencies:** 5

**Files likely touched:** `packages/cli/src/command/list-rules.ts`, `packages/cli/src/command/__tests__/list-rules.test.ts`

**Estimated scope:** XS

## Task 8: Every repo can get Protect main

**Description:** `protectMain`, the spec's body, and `ensureProtectMain`: list the rulesets, get the one named "Protect main", compare it with the body, then `POST` or `PUT` only when needed.

**Acceptance criteria:**
- [x] Through a sample command: brain's real ruleset (note 09) gives a skipped step and no write; no ruleset gives a `POST` with the body; a "Protect main" with a missing rule gives a `PUT` on its id.
- [x] Other rulesets of the repo get no call beyond the list.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/github`
- [x] `bun run check` is green.

**Dependencies:** 5

**Files likely touched:** `packages/cli/src/github/settings.ts`, `packages/cli/src/github/__tests__/settings.test.ts`

**Estimated scope:** Small

## Task 9: A step retries an unexpected 404 or 409

**Description:** `ghApi` takes the statuses a call expects. A 404 or 409 that the call does not expect is tried again up to 3 times, 3 seconds apart, through `context.sleep`, before it becomes final. The settings steps use it.

**Acceptance criteria:**
- [x] Through a sample command: a 404, then a 200, on the Actions setting's GET gives a done step after one 3-second sleep in `calls`.
- [x] Four 404s end with exit 2 after three sleeps; a status the call expects, and any status other than 404 and 409, is never tried again.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/github`
- [x] `bun run check` is green.

**Dependencies:** 4, 5

**Files likely touched:** `packages/cli/src/github/gh.ts`, `packages/cli/src/github/settings.ts`, `packages/cli/src/github/__tests__/gh.test.ts`

**Estimated scope:** Small

## Checkpoint: the tracer and the settings

- [ ] `bun run check` is green.
- [ ] Every case of `checkLogin`, `ensureActionsSetting` and `ensureProtectMain` in the spec's "Testing strategy" passes, and so does the answers-to-failure table.
- [ ] A second run of both settings steps makes no write.

## Task 10: ensureRepo creates a repo, or reuses only this run's repo

**Description:** `ensureRepo` reads the repo. On 404 it creates it in the organization with the name, the description and the visibility. When the repo exists, it checks the visibility, then reads the default branch: 409 "Git Repository is empty" means reuse; a commit means reuse only when `git merge-base --is-ancestor <sha> HEAD` succeeds in `localRoot`. `git.ts` starts with that command line.

**Acceptance criteria:**
- [ ] Through a sample command: a 404 gives a `POST` with the asked fields and a done step (`made: "created"`); an empty repo, and a repo whose main commit is in the local history, give a skipped step (`made: "reused"`) and no write.
- [ ] Another visibility, a commit outside the local history, an unknown owner, and a 422 "name already exists" each end with exit 2 naming the repo, and make no write.
- [ ] Against a real git repo in a temp folder, the local-history check says yes for an ancestor, and no for another commit and for an unknown sha.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/github`
- [ ] `bun run check` is green.

**Dependencies:** 5 (after task 9 by order)

**Files likely touched:** `packages/cli/src/github/repo.ts`, `packages/cli/src/github/git.ts`, `packages/cli/src/github/__tests__/repo.test.ts`, `packages/cli/src/github/__tests__/git.test.ts`

**Estimated scope:** Medium

## Task 11: push and clone through gh's login

**Description:** `git.ts` gains the command lines that reach GitHub: each starts with the host-scoped credential helper arguments and adds `GIT_TERMINAL_PROMPT=0`. `push` checks or adds `origin`, compares `git ls-remote` with the local commit, then pushes with `--set-upstream`. `clone` clones the HTTPS URL into a new folder.

**Acceptance criteria:**
- [ ] Through a sample command: no `origin` gets the HTTPS URL added; another `origin` ends with exit 2; a branch already at the local commit gives a skipped step; a new push uses gh's helper and `GIT_TERMINAL_PROMPT=0`; a rejected push ends with exit 1 and git's message.
- [ ] `clone` uses gh's helper and the HTTPS URL; an existing folder ends with exit 2 and no git call.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/github`
- [ ] `bun run check` is green.

**Dependencies:** 10

**Files likely touched:** `packages/cli/src/github/push.ts`, `packages/cli/src/github/git.ts`, `packages/cli/src/github/__tests__/push.test.ts`

**Estimated scope:** Medium

## Task 12: openPullRequest reuses an open PR or opens one

**Description:** `openPullRequest` reads the open PRs from the head into the base, and opens one only when none exists.

**Acceptance criteria:**
- [ ] Through a sample command: an open PR gives a skipped step (`made: "reused"`) and no `POST`; none gives a `POST` with the title, head, base and body, and a done step.
- [ ] The head in the query is URL-encoded, so a branch with `/` or `#` reaches GitHub whole.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/github`
- [ ] `bun run check` is green.

**Dependencies:** 5

**Files likely touched:** `packages/cli/src/github/pull-request.ts`, `packages/cli/src/github/__tests__/pull-request.test.ts`

**Estimated scope:** Small

## Task 13: watchRun waits for a run, and findTag reads a tag

**Description:** `watchRun` polls the push runs of a commit every 10 seconds until the run of the given workflow file appears (within 2 minutes), then polls that run until it completes (within 30 minutes), and reports each status change as an info message. It returns the conclusion; the step ends as done for `success` and as failed for any other. `findTag` reads a tag's commit, or `null` for a 404.

**Acceptance criteria:**
- [ ] Through a sample command: a run that appears on the second poll and succeeds gives a done step; one that fails gives a failed step, its conclusion in the result, and exit 0; the polls in `calls` are 10 seconds apart.
- [ ] A run that does not appear in 2 minutes, or does not complete in 30, ends with exit 3 (the second names the run's URL); the step's options change all three times.
- [ ] `findTag` returns the commit for a tag, and `null` for a 404.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/github`
- [ ] `bun run check` is green.

**Dependencies:** 4, 5

**Files likely touched:** `packages/cli/src/github/runs.ts`, `packages/cli/src/github/__tests__/runs.test.ts`

**Estimated scope:** Medium

## Checkpoint: github-ops complete

- [ ] `bun run check` is green, on the working copy and on a clean clone of the branch.
- [ ] Every success criterion of `spec/SPEC-github-ops.md` passes.
- [ ] `packages/cli/src/github` holds no `gh auth token`, no `--show-token` and no `--force`.
- [ ] `/brain:review` on the branch, then the PR into `main`, asked first.
