# Review: the github-ops module

The final-checkpoint review of module `github-ops` (`/brain:review`, the five-axis review of `code-review-and-quality`), run on 2026-10-20 before the module's PR into `main`.

**Verdict: request changes.** The approach is sound, and the spec is met: every step, every World limit, the process groups, the `GIT_` removal (ADR-0016) and the failure table exist and have tests. Two Required findings stand: one security finding on `push`, and four pieces of duplicated code. The readability axis confirms Peter's concern of 2026-10-20 that the code is "harder than it needs to be": about 120 to 150 source lines could go with no change in behaviour.

## Context

| Item | Value |
|---|---|
| Fixed point | merge-base `bb0c949` (the spec's approval on `main`); diff `git diff bb0c949...HEAD`; 39 commits; about 3,500 lines of source in 18 files and about 8,000 lines of tests |
| Spec | `spec/SPEC-github-ops.md`, with ADR-0014, ADR-0015 and ADR-0016 |
| Standards | `AGENTS.md`, `CLAUDE.md`, `spec/README.md`, the spec's "Code style" and "Boundaries", ADR-0007, `CONTEXT.md`, `oxlint.config.ts`, `oxfmt.config.ts` |
| Axes | correctness, readability, architecture, security, performance: five parallel sub-agents on Sonnet, another model than the one that wrote the code; plus the orchestrator's own read of the tests |

## Verification story

- `bun run check` is green by its own exit code: 614 tests (213 at the base), on the working copy and on a clean clone of the pushed branch.
- Each of the 13 tasks and 9 extra slices was built test-first by a fresh sub-agent, which ran the five-axis review on its own diff; the orchestrator ran the gate again before each push.
- No test calls GitHub. Real git runs only against temp repos and a local bare repo; real programs and requests only against `bun -e` and local servers.
- `packages/cli/src/github` reads and prints no token, and holds no `--force` (one doc comment names `--show-token` as what gh runs without).

## Findings, ranked by leverage

### Required

1. **A push can follow a rewrite of the URL to another host.** `[judgement]` (security; correctness item 3)
   `packages/cli/src/github/git.ts` `originUrls`, and `push.ts` `ensureOrigin`: the step reads `remote.origin.url` and `pushurl` as written, but git applies `url.<base>.insteadOf` and `pushInsteadOf` from git's config when it pushes. A local config that rewrites `https://github.com/` sends the push, and a credential from the user's own helper, to another host. A global SSH rewrite (`git@github.com:`) sends it over SSH and skips gh's login.
   Fix: before the push, read the URL that git will really use (`git remote get-url --push origin`, which applies the rewrites) and refuse, with exit 2, any URL that does not point at the repo on github.com. Test both rewrites.

2. **Duplicated code.** `[judgement]` (readability; architecture items 2, 3 and 4)
   - `ghEnv` (`GH_PROMPT_DISABLED`, `GH_NO_UPDATE_NOTIFIER`) is defined in `gh.ts` and again in `login.ts`.
   - The commit-sha check is `commitShaSchema` in `git.ts` and again `shaSchema` in `runs.ts`.
   - Branch names have two rules: `branchNameSchema` in `git.ts` (git's own rules) and `branchSchema` with `checkBranches` in `pull-request.ts`, which allows names that git refuses and lets a bidi mark (`\p{Cf}`) through (security item 2).
   - The text built from zod's issues for an answer that acmelabs cannot read is written twice: `readBody` in `gh.ts` and `readStatus` in `login.ts`.
   Fix: one of each; the branch rule bans `\p{Cf}` too.

### Optional

3. **A step reaches into the World's internals.** `[judgement]` (architecture item 6) `runs.ts` imports `durationOf` from `command/world-limits.ts`. Fix: move the words for a time and a size to a neutral file that both use.
4. **The same step frame in eight steps.** `[judgement]` (readability item 1) Each step builds its `kind/step/title` object, sends `started`, then `done` or `skipped`. Fix: one `runStep(context, { step, title }, body)`; about 40 lines fewer, and no step can forget `started`.
5. **`gh.ts` changes for five reasons in 581 lines.** `[judgement]` (architecture item 1, Divergent Change) The login wording, `shownText`, the `gh api` call, the failure table and `repoPath` share one file; `git.ts` and `login.ts` import it for the login words and `shownText` only. Fix: `gh-login.ts` for the login words, a text file for `shownText`; `gh.ts` keeps the API call and its failures. Do it before `scaffold` adds more importers.
6. **The words for a limit are built by hand.** `[judgement]` (readability item 3) `countOf`, `durationOf`, `sizeOf` and the KB and MB branches are about 30 lines; `programLimits` and `requestLimits` wrap `positiveLimit` four times. Fix: one `durationOf`, a simpler `sizeOf`, one check per field; about 25 lines fewer.
7. **Two poll loops of one shape.** `[judgement]` (readability item 7) `appearedRun` and `completedRun` in `runs.ts` each build a deadline and call `nextWaitMs`; `checkedWaits` repeats `positiveLimit`'s rule. Fix: one `pollUntil(context, deadline, pollMs, tick)`; about 20 lines fewer.
8. **`failureFor` is a nine-branch chain with long inline messages.** `[judgement]` (readability item 5) Fix: a named function per message, or a table by status.
9. **Bare calls kept only for the check they throw.** `[judgement]` (readability item 6) `httpsUrl(repo);` and `repoPath(repo);` stand alone in `git.ts` and `push.ts`. Fix: one `checkRepo(repo)` at each step's entry.
10. **The test suite takes 11 s, up from about 3 s.** `[judgement]` (performance item 1) The World's tests use real timers on purpose; `world-spawn.test.ts`'s 2-second sleepers mostly wait for a stop at 200 ms. Fix: shorter sleepers; about 1 to 2 s faster.
11. **A folder that is not a git repo ends with exit 3.** `[judgement]` (correctness items 4 and 5) In `push` it is bad input from the caller, so exit 2 fits the table; in `inLocalHistory` exit 128 then reads as "not in the local history", which misleads.
12. **The retry loop is written twice.** `[judgement]` (architecture item 5, Nit) `ghApi` and `runOnGitHub` share one shape; two sites with different predicates.
13. **`loginNeeded` takes two forms.** `[judgement]` (architecture item 7, Nit) A string or a `LoginFix`; only gh uses the object form. Revisit when npm's login lands.

### Records

14. **Scope creep, not yet in the github-ops spec.** `[judgement]` (correctness items 1 and 2) Network failures as outside failures (`c52a4df`) are in `spec/SPEC-command-core.md` but not in the github-ops spec's World section; `ensureProtectMain`'s exit 2 for two rulesets named "Protect main" is not in the spec. Fix: one sentence each.
15. **"Every GitHub call goes through `ghApi` or `git.ts`."** `[judgement]` (architecture item 8) `checkLogin` starts `gh auth status` itself, a local read. Fix: the boundary line names it.
16. **One page of 100.** `[judgement]` (performance item 2) The rulesets, open PRs and push runs are read with `per_page=100` and no paging. Real repos stay far below; record it as a known limit in the spec.
17. **Stale records.** `[hard: AGENTS.md, "Session end"]` (correctness items 8 and 9) `docs/STATUS.md` and the `github-ops` row of `spec/README.md` predate task 11. Fix: at the merge.

### FYI

- git and a repo's own hooks get `GH_TOKEN` and the whole environment (ADR-0015); a repo's hooks are code the user already runs. (security item 3)
- Redaction covers environment secrets, URL credentials, secret query values and Bearer tokens; a keyring token never enters acmelabs. (security item 4)
- `ensureActionsSetting` names its 409 as expected, so a 409 right after a create reads as "the organization forbids it"; spec open question 1 covers it, and `scaffold`'s acceptance run decides it. (correctness item 6)
- `findTag` gives `null` for a 404 of a missing repo too, as the spec says. (correctness item 7)
- `shownText` runs at about 60 call sites; applying it once where a failure is built would be shorter, but changes the API, and a cut on a whole message would remove the fix that follows the outside text. (readability item 8; the last slice's review weighed it)

## Checked and clean

- Every step, limit and success criterion of the spec has code and a test; no off-by-one, race or state error found. (correctness)
- Names gate every API path and git argument; branches go in as `refs/heads/<branch>`; `clone` uses `--`; no shell; bodies go on stdin. (security)
- Dependencies flow one way, with no cycle; the World's split keeps the limits in one place; no speculative generality; type boundaries explicit. (architecture)
- Each step makes a fixed, small number of calls; polling is bounded and goes through `context.sleep`; output and bodies stop at their limits; no leaked timers. (performance)
