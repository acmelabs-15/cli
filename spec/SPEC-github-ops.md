# Spec: github-ops

Module `github-ops`, layer 1 of the capability map (`spec/README.md`). It builds on `command-core` for the command's context, the failure helpers and the World, and it changes the World at Peter's choice (open questions 21 and 22). Words follow `CONTEXT.md`. Status: approved by Peter on 2026-10-20, with the agent's calls as written.

## Objective

`acmelabs new` must create a GitHub repo, give it the Actions setting and Protect main, push it, and wait for its first release run. `acmelabs marketplace add` must clone the marketplace, push a branch and open a PR. Today a person does each of these steps by hand with `gh` (acmelabs-15/cli was made that way on 2026-10-20, `docs/research/09-github-steps.md`, section 5). This module gives the later commands those steps once, each one safe to run again.

It also settles the two open questions that the `command-core` review deferred to it: which environment variables an outside program gets, and the time and output limits of outside programs and requests.

The users are the modules that call the steps (`scaffold`, `marketplace-add`), every later command through the World's limits, and the maintainer who runs `acmelabs new` and must be able to run it again after a failure.

Acceptance: see "Success criteria".

## Settled before this spec

| Decision | Source |
|---|---|
| Every GitHub REST call runs `gh api`; push and clone run git with gh's credential helper. One login, gh's; acmelabs never holds a token | Peter, 2026-10-20; ADR-0014 |
| A step reads before it writes and reports itself as skipped when its result is already there. An existing repo is reused only when it is empty or its main commit is in the local history; any other existing repo, or one with the other visibility, ends the command with exit 2 | Peter, 2026-10-20 |
| Outside programs get the whole environment, as today (open question 21) | Peter, 2026-10-20; ADR-0015 |
| Every program and request has a time limit and an output limit that a call can change: 5 minutes per program, 1 minute per request, 10 MB per output. At a limit, acmelabs stops the program and every program it started, and the command ends with exit 3 (open question 22) | Peter, 2026-10-20; ADR-0015 |
| Protect main is brain's ruleset; the Actions setting is brain's: read-only tokens, and workflows may create and approve pull requests | interview Q5; `docs/research/09-github-steps.md`, sections 2.5 and 2.6 |
| An entry's source and every remote use the HTTPS URL, never the `owner/repo` SSH form | the marketplace's README; note 01 |
| The test seams: the command seam for the steps, the World's own tests for the limits; no test calls GitHub | Peter, 2026-10-20 |

## Tech stack

- Bun 1.4.0, TypeScript, `bun:test`, zod 4, as in `command-core`.
- gh on PATH (2.98.0 here; any gh with `gh auth status --json` and `gh api --input`), and git (2.54.0 here). No new npm dependency.
- **Agent's call, small and reversible:** every `gh api` call sends `X-GitHub-Api-Version: 2026-03-10`. A call with no version gets `2022-11-28`, whose support ends on 2028-03-10. The breaking changes of `2026-03-10` touch none of the fields the steps read (note 09, section 2.1).

## The GitHub steps

Each step is a function that a command calls inside `run`. Each one reports one progress step with a stable id, reads before it writes, and returns a JSON result. A step takes a `StepContext`: the command's context without `ask`, because no step asks a question.

| Step | Id | Reads, then writes | Result |
|---|---|---|---|
| `checkLogin(context, { scopes })` | `github-login` | `gh auth status --hostname github.com --json hosts` | `{ login, scopes }` |
| `ensureRepo(context, { repo, visibility, description?, localRoot })` | `github-repo` | `GET repos/{owner}/{name}`; on 404, `POST orgs/{owner}/repos` | `{ url, cloneUrl, made: "created" \| "reused" }` |
| `ensureActionsSetting(context, repo)` | `github-actions-setting` | `GET`, then `PUT repos/{owner}/{name}/actions/permissions/workflow` | `"done" \| "skipped"` |
| `ensureProtectMain(context, repo)` | `github-protect-main` | `GET repos/{owner}/{name}/rulesets`, the one named "Protect main", then `POST` or `PUT` | `"done" \| "skipped"` |
| `push(context, { repo, cwd, branch })` | `github-push` | `git ls-remote`, then `git push --set-upstream origin <branch>` | `{ sha, pushed: boolean }` |
| `clone(context, { repo, into })` | `github-clone` | `git clone <https url> <into>` | `{ into }` |
| `openPullRequest(context, { repo, head, base, title, body })` | `github-pull-request` | `GET repos/{owner}/{name}/pulls?head=...&base=...&state=open`, then `POST` | `{ number, url, made: "created" \| "reused" }` |
| `watchRun(context, { repo, headSha, workflow })` | `github-run` | `GET repos/{owner}/{name}/actions/runs?head_sha=...&event=push`, then `GET .../runs/{id}` until it completes | `{ id, url, conclusion }` |
| `findTag(context, repo, tag)` | none: a read | `GET repos/{owner}/{name}/git/ref/tags/{tag}` | `{ sha } \| null` |

**Agent's call, small and reversible:** `clone` and `findTag` join the map's list. `marketplace-add` needs a local copy of the marketplace to run `claude plugin validate . --strict`, and `scaffold` asks the marketplace question only once the latest tag exists (interview Q5). `checkLogin` checks the login before the first write, so a missing scope shows before a half-made repo.

### What each step does

- **`checkLogin`** reads gh's account for github.com. No account, or a state other than `success`, is a login failure that names `gh auth login`. When the token reports scopes (a `gho_` or `ghp_` token) and one of the asked scopes is missing, it is a login failure that names `gh auth refresh -h github.com -s <scope>`. A token that reports no scopes (a fine-grained or app token) skips the scope check, as gh does. `scaffold` asks for `repo` and `workflow`: pushing a file under `.github/workflows/` needs `workflow` (note 09, section 4).
- **`ensureRepo`** creates the repo in the organization with `name`, `description` and `visibility`, and GitHub's defaults for everything else, as brain, jev-gate, the marketplace and this repo have (read on 2026-10-20). When the repo exists, the step checks it, in order: the same visibility, else exit 2; then `GET .../git/ref/heads/{default branch}`: 409 "Git Repository is empty" means it is this run's repo; a commit for which `git merge-base --is-ancestor <sha> HEAD` succeeds in `localRoot` means it is this run's repo; anything else is exit 2 that names the repo. acmelabs never changes a repo's visibility: private to public makes the Actions logs public and erases stars (GitHub's docs).
- **`ensureActionsSetting`** reads the setting and writes it only when it differs. A 409 means the organization forbids it: a problem (exit 1) whose message names the organization's Actions settings page.
- **`ensureProtectMain`** finds the ruleset named "Protect main". It compares the name, target, enforcement, the included and excluded refs, the rule types and the bypass list with the body below. Equal: skipped. Different: `PUT` with the body. Missing: `POST`.
- **`push`** makes sure the remote `origin` is the repo's HTTPS URL: it adds `origin` when missing, and a different `origin` is exit 2. When `git ls-remote` shows the branch at the local commit, the step is skipped. A push is never forced. GitHub's rejection of a push is a problem (exit 1) with git's message.
- **`clone`** clones into a folder that must not exist yet; an existing folder is exit 2.
- **`openPullRequest`** reuses an open PR from the same head into the same base, else opens one. The head is a branch of the same repo.
- **`watchRun`** waits for the push run whose `path` is the given workflow file, such as `.github/workflows/release.yml`, then polls it until its status is `completed`. It reports each status change as an info message. The step ends as done for the conclusion `success` and as failed for any other, and it returns the conclusion in either case: the caller decides what a failed run means (`scaffold` then prints `acmelabs marketplace add` for later, interview Q5).
- **`findTag`** returns the tag's commit, or `null` when GitHub answers 404.

**Agent's calls for `watchRun`, small and reversible:** one poll every 10 seconds; the run must appear within 2 minutes and complete within 30 minutes. Each is an option of the step. Reasons: gh's own 3-second watch costs about 2,400 requests per hour of the 5,000 limit, and 10 seconds with one GET costs 360. brain's runs appeared 1 to 3 seconds after a push, and the runs list carries `Cache-Control: max-age=60`, so 2 minutes covers a stale list. At either limit the step ends with exit 3 and the run's URL; the run goes on in GitHub.

**Agent's call, from reports:** right after a create, GitHub can answer 404 or 409 for a few seconds (note 09, section 3.1: go-github's doc comment, gh's own clone retry). A step retries such an answer, when the step does not expect it, up to 3 times, 3 seconds apart, before it treats the answer as final. The retry is UNVERIFIED against these endpoints; `scaffold`'s acceptance run proves the sequence.

### Protect main and the Actions setting

```ts
// packages/cli/src/github/settings.ts
/** The Actions setting: read-only workflow tokens, and workflows may create and approve PRs. */
export const actionsSetting = {
  default_workflow_permissions: "read",
  can_approve_pull_request_reviews: true,
} as const;

/** Protect main: no force-push and no deletion on the default branch, and no one may bypass it. */
export const protectMain = {
  name: "Protect main",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
  bypass_actors: [],
} as const;
```

The body is the one that made acmelabs-15/cli's ruleset (note 09, section 5). brain's and this repo's rulesets are equal to it, apart from ids and dates.

### How a step calls gh and git

- **`gh api`:** `["gh", "api", "--hostname", "github.com", "--method", <method>, "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", <path>]`, plus `["--input", "-"]` with the JSON body on stdin for a write. The call adds `GH_PROMPT_DISABLED=1` and `GH_NO_UPDATE_NOTIFIER=1` to the environment. On exit 0, stdout is the JSON answer, or empty for a 204. On exit 1, stdout is GitHub's JSON error body, with `status` as a string (note 09, section 1.2).
- **git:** every call that reaches GitHub starts with `-c credential.https://github.com.helper= -c "credential.https://github.com.helper=!gh auth git-credential"`, the arguments gh itself gives git for a clone (note 09, section 1.5). The first clears any other helper for github.com, so gh's login is the one login. The call adds `GIT_TERMINAL_PROMPT=0`, so git never asks for a password on the terminal: a command asks only through `context.ask` (ADR-0007).
- **Names:** an owner and a repo name pass a check before any call, because they go into an API path: an owner is 1 to 39 letters, digits or hyphens and starts with a letter or digit; a name is 1 to 100 letters, digits, `.`, `_` or `-`, and not `.` or `..`. A branch in a query is URL-encoded.

### GitHub's answers and the failure kinds

**Agent's call:** each answer maps to the failure kind that tells the caller what to do next, as ADR-0007 asks.

| Answer | Kind | Exit | The message names |
|---|---|---|---|
| gh is not on PATH | `outside` | 3 | gh (the World does this today) |
| gh exits 4 (no login), or GitHub answers 401 | `login` | 4 | `gh auth login` |
| The login lacks an asked scope | `login` | 4 | `gh auth refresh -h github.com -s <scope>` |
| 404 for the owner; 403 or 404 for a repo the login cannot change; 422 "name already exists" | `input` | 2 | the owner or repo, and the login |
| An existing repo that holds other work, or has the other visibility; another `origin`; an existing clone folder | `input` | 2 | the repo or folder |
| 409 on the Actions setting; a push that GitHub rejects | `problem` | 1 | the organization's settings page; git's message |
| A rate-limit answer (403 or 429 with "rate limit" in the message), any 5xx, a network failure, a time or output limit, a run that does not appear or complete in time | `outside` | 3 | GitHub's message, the limit, or the run's URL |
| Any other answer | `outside` | 3 | the method, the path and GitHub's message |

`loginNeeded(service)` gains an optional second argument, the command line that fixes the login, so the message can name `gh auth refresh ...`.

## The World's limits

A change to `packages/cli/src/command/world.ts`, at Peter's choice (open questions 21 and 22).

```ts
/** The limits that every outside program and request gets unless the call changes them. */
export const limits = {
  /** A program's time limit: 5 minutes. */
  programMs: 5 * 60 * 1000,
  /** A request's time limit, to the end of its body: 1 minute. */
  requestMs: 60 * 1000,
  /** The most bytes kept from stdout, from stderr, or from a response body: 10 MB. */
  outputBytes: 10 * 1024 * 1024,
} as const;

export type SpawnOptions = {
  cwd?: string;
  stdin?: string;
  signal?: AbortSignal;
  /** Variables added to the environment the program gets, such as GIT_TERMINAL_PROMPT=0. */
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

/** A request's options: fetch's own, and its limits. */
export type FetchInit = RequestInit & { timeoutMs?: number; maxBodyBytes?: number };

export type World = {
  root: string;
  env: Readonly<Record<string, string | undefined>>;
  spawn: (commandLine: readonly string[], options?: SpawnOptions) => Promise<Spawned>;
  fetch: (input: string | URL | Request, init?: FetchInit) => Promise<Response>;
  now: () => Date;
  /** Waits, unless the signal aborts first. A fake World moves its clock instead of waiting. */
  sleep: (ms: number, options?: { signal?: AbortSignal }) => Promise<void>;
};
```

- **The environment:** a program gets the whole environment, as today, plus the call's `env`. No variable is removed (ADR-0015).
- **A program runs in its own process group** (`detached: true`). At its time limit, at its output limit, or on a cancel, acmelabs sends SIGTERM to the whole group, then SIGKILL after a grace of 5 seconds, so no program that it started keeps acmelabs waiting (note 10, section 2). A group that is already gone, or whose programs have all ended, is not an error, and the SIGKILL is then dropped, so acmelabs exits at once (fix `586c53b`).
- **The output limit** counts the bytes of stdout and of stderr, each on its own, with a stream reader. Bun's `maxBuffer` is not used: it overshoots, and it cannot tell its stop from another SIGTERM (note 10, section 2).
- **A limit is an outside failure** (exit 3) whose message names the program and the limit, such as `gh api ... ran longer than 5 minutes and was stopped`. A cancel still rejects with the signal's reason, as today.
- **A request** gets `AbortSignal.timeout(timeoutMs)` beside its own signal, to the end of its body. A `Content-Length` above the limit fails before the body is read; a counting reader stops any other body at the limit. `TimeoutError` and an over-limit body are outside failures; a cancel stays a cancel.
- **`fetch` becomes a plain function type**, so the World no longer copies Bun's `preconnect`.
- **`sleep`** joins the World, so `watchRun` waits through it and a test passes 30 minutes in no time. The context passes the run's signal to `sleep`, as it does to `spawn` and `fetch`.
- **`fakeWorld`** scripts the two limits: a scripted spawn or fetch answer can be `limit: "time"` or `limit: "output"`, which rejects with the same outside failure as the real one. Its `sleep` moves its clock and logs `{ kind: "sleep", ms }`. Its log keeps every spawn option except `signal`, as today.
- **Agent's call, small and reversible:** `realWorld` takes an optional grace for SIGKILL, so a test of a program that ignores SIGTERM takes 0.2 seconds, not 5.

## Commands

The module adds no `acmelabs` command. `scaffold` and `marketplace-add` call its steps.

```
bun run check                          # the gate
bun test packages/cli/src/github       # the steps
bun test packages/cli/src/command      # the World's limits, and the rest of command-core
```

## Project structure

```
packages/cli/src/github/names.ts            ownerSchema, repoNameSchema, GitHubRepo: zod only
packages/cli/src/github/gh.ts               ghApi: one REST call through gh api; StepContext; the answers-to-failure table
packages/cli/src/github/git.ts              git's command lines: gh's credential helper, no terminal prompt
packages/cli/src/github/login.ts            checkLogin
packages/cli/src/github/repo.ts             ensureRepo
packages/cli/src/github/settings.ts         actionsSetting, protectMain, ensureActionsSetting, ensureProtectMain
packages/cli/src/github/push.ts             push, clone
packages/cli/src/github/pull-request.ts     openPullRequest
packages/cli/src/github/runs.ts             watchRun, findTag
packages/cli/src/github/__tests__/          one test file per step file, at the command seam
packages/cli/src/command/world.ts           the limits, env, process groups, sleep (changed)
packages/cli/src/command/run.ts             the context's sleep takes the run's signal (changed)
packages/cli/src/command/outcome.ts         loginNeeded takes the fixing command line (changed)
packages/cli/src/command/list-rules.ts      a command file may load ../github/names at its top (changed)
packages/cli/src/command/__tests__/world.test.ts   the limits (changed)
spec/SPEC-command-core.md                   the World section, kept current (changed)
```

- **Agent's call, small and reversible:** a command file may import `../github/names` at its top, because that file loads only zod and a command's input checks a repo name with it. Every other github-ops file loads inside `run` with `await import(...)`, as the command list's rule asks.
- `gh.ts` builds `gh api` command lines and reads their answers; no other file starts gh for the API. `git.ts` holds the git command lines; no other file starts git.

## Code style

As in `repo-model`, `command-core` and `config-presets`: `type` for shapes, function declarations with helpers above their callers, every export has a doc comment whose first line says what it is, Bun APIs, 100 columns, trailing commas. A step reads like this:

```ts
/**
 * Gives the repo the Actions setting. It reads the setting first and reports the step as skipped
 * when the setting is already there. A 409 means the organization forbids the setting.
 */
export async function ensureActionsSetting(
  context: StepContext,
  repo: GitHubRepo,
): Promise<"done" | "skipped"> {
  const step = {
    kind: "step",
    step: "github-actions-setting",
    title: `Set the Actions setting on ${repo.owner}/${repo.name}`,
  } as const;
  context.progress({ ...step, status: "started" });
  const path = `repos/${repo.owner}/${repo.name}/actions/permissions/workflow`;
  const current = answerOrThrow(await ghApi(context, { path }), repo);
  if (sameSetting(current, actionsSetting)) {
    context.progress({ ...step, status: "skipped", detail: "already set" });
    return "skipped";
  }
  const written = await ghApi(context, { method: "PUT", path, body: actionsSetting });
  if (!written.ok && written.status === 409) {
    throw problem(
      `the ${repo.owner} organization forbids this setting; an owner allows it at ${orgPage(repo)}`,
    );
  }
  answerOrThrow(written, repo);
  context.progress({ ...step, status: "done" });
  return "done";
}
```

## Testing strategy

Two seams, both existing (Peter, 2026-10-20). No test calls GitHub.

**The command seam, for the steps.** Each test runs a sample command that calls one step, through `runCommand`, with `fakeWorld`. The fake answers each `gh` and `git` command line from a script, with stdout and the exit code that gh gives (note 09). The test checks the outcome and its exit code, the progress steps, and the exact calls in `world.calls`, so a test fails when a step writes where it should only read. Answers come from real responses: brain's ruleset, the 404 and 409 bodies, the runs list (note 09, sections 2.6 to 2.9).

Cases:

- **`checkLogin`:** logged in with `repo` and `workflow`; no account (exit 4, `gh auth login`); a state of `error`; `workflow` missing (exit 4, `gh auth refresh -h github.com -s workflow`); a token with no scopes passes.
- **`ensureRepo`:** a new repo is created with the asked visibility and description; an empty existing repo is reused; an existing repo whose main commit is in the local history is reused; an existing repo with other work is exit 2 and no write is made; an existing repo with the other visibility is exit 2; an unknown owner is exit 2; a 422 "name already exists" is exit 2; an owner or name that fails the name check is exit 2 before any call.
- **`ensureActionsSetting`:** set already (skipped, no `PUT`); different (`PUT` with the body); 409 (exit 1, names the settings page).
- **`ensureProtectMain`:** brain's ruleset (skipped); none (`POST` with the body); one with a missing rule (`PUT`); other rulesets beside it are left as they are.
- **`push`:** no `origin` (added); another `origin` (exit 2); the branch already at the local commit (skipped); a new push with gh's helper and `GIT_TERMINAL_PROMPT=0`; a push rejected (exit 1).
- **`clone`:** a clone with gh's helper; an existing folder (exit 2).
- **`openPullRequest`:** an open PR reused; a new PR opened; the head branch URL-encoded in the query.
- **`watchRun`:** the run appears on the second poll and succeeds (done); it fails (the step fails, the conclusion is returned, the command decides); it never appears (exit 3 after 2 minutes of fake time); it does not complete in 30 minutes (exit 3, the run's URL); the polls are 10 seconds apart in `world.calls`.
- **`findTag`:** found; 404 gives `null`.
- **Retries and answers:** a 404 that the step does not expect, then a 200, succeeds after one 3-second wait; a rate-limit answer is exit 3; a 5xx is exit 3; gh not installed is exit 3; an answer that is not JSON is exit 3 with gh's stderr.

**The World's own tests, for the limits.** As `world.test.ts` does today: real `bun -e` programs and a local `Bun.serve` server, in milliseconds.

- A program past its time limit is stopped and the call fails with exit 3 naming the limit; a call that raises the limit lets it finish.
- A program that prints past its output limit is stopped, and the call fails with exit 3; a call that raises the limit keeps all of it.
- A program that starts its own child (`bash -c "(sleep 2; echo late) & sleep 10"`) ends with its child at a time limit and on a cancel, in well under 2 seconds.
- A program that ignores SIGTERM is killed after the grace.
- The call's `env` reaches the program beside the whole environment.
- A request with slow headers, and one with a slow body, fail at the time limit with exit 3; a cancel stays a cancel; a body past the limit fails, by its `Content-Length` and by counting.
- `fakeWorld`'s `limit` answers and its `sleep` behave as above.

## Boundaries

- **Always:** every GitHub call goes through `ghApi` or a command line from `git.ts`.
- **Always:** a step reads before it writes, and reports one progress step with a stable id.
- **Always:** an owner and a repo name pass the name check before any call.
- **Always:** a remote is the HTTPS URL.
- **Ask first:** a change to Protect main, to the Actions setting or to a default limit. Each one changes every ACMElabs repo or every command.
- **Ask first:** a new GitHub step.
- **Never:** change a repo that holds other work; change a repo's visibility; force a push; delete a repo or a branch.
- **Never:** read or print a token: no `gh auth token`, and no `--show-token`.
- **Never:** call GitHub from a test.

## User stories

1. As a maintainer, I want `acmelabs new` to create the GitHub repo for me, so that I never click through GitHub's form.
2. As a maintainer, I want every new repo to get Protect main, so that no one force-pushes or deletes main.
3. As a maintainer, I want every new repo to get the Actions setting, so that changesets can open the Version Packages PR.
4. As a maintainer, I want a new repo pushed over HTTPS with my gh login, so that a machine with no SSH key works too.
5. As a maintainer, I want acmelabs to check my gh login and its scopes first, so that a missing `workflow` scope stops the run before it makes anything.
6. As a maintainer, I want a missing login to name the gh command that fixes it, so that I can fix it in one step.
7. As a maintainer whose `acmelabs new` stopped halfway, I want to run it again and have it pick up where it stopped, so that I clean up nothing by hand.
8. As a maintainer, I want acmelabs to refuse a repo name that holds someone else's work, so that it never changes that repo's settings.
9. As a maintainer, I want acmelabs never to change a repo's visibility, so that it never makes Actions logs public by accident.
10. As a maintainer, I want `acmelabs new` to wait for the first release run and tell me how it ended, so that I know the latest tag exists before the marketplace question.
11. As a maintainer, I want the wait for a run to end after 30 minutes with the run's URL, so that a stuck run does not hold my terminal.
12. As the `scaffold` module, I want each step as one function with a typed result, so that the `new` flow is a short list of calls.
13. As the `scaffold` module, I want a failed run returned, not thrown, so that I decide what to tell the user.
14. As the `scaffold` module, I want to read the latest tag, so that I ask the marketplace question only when the plugin can install.
15. As the `marketplace-add` module, I want to clone the marketplace, push a branch and open a PR, so that adding a plugin needs no manual git.
16. As the `marketplace-add` module, I want an open PR for my branch reused, so that a re-run does not fail on "a pull request already exists".
17. As an agent in JSON mode, I want each GitHub step as a progress step with a stable id, so that I can follow `acmelabs new` and tell which step failed.
18. As a script, I want GitHub's answers mapped to the exit codes, so that I retry a rate limit and fix a bad name.
19. As a maintainer in CI, I want every outside program stopped after 5 minutes, so that a hung validator does not run until the 6-hour job limit.
20. As a maintainer, I want a program's flood of output stopped at 10 MB, so that acmelabs cannot fill memory.
21. As a user who presses Ctrl+C, I want every program that acmelabs started to stop, including their own children, so that nothing keeps running after the cancel.
22. As a command's author, I want to raise a limit for one call, such as a first `bun install`, so that a slow but healthy program can finish.
23. As a command's author, I want a fake clock in the fake World, so that a test of a 30-minute wait takes milliseconds.
24. As a reviewer, I want the exact gh and git calls in each test, so that a step that writes when it should only read fails a test.
25. As Peter, I want acmelabs never to read or print my token, so that no output or log can leak it.
26. As a maintainer of this repo, I want no test to touch GitHub, so that `bun run check` runs offline and makes no repos.

## Out of scope

- The order of the steps in `acmelabs new`, the marketplace question, and what a failed run means: `scaffold`.
- Editing the marketplace's registry files and README, and running its validator: `marketplace-add`.
- Local git work: `git init`, staging, commits and branches. The callers do it.
- A command that gives an existing repo Protect main and the Actions setting (jev-gate has no ruleset; acmelabs-15/skills has the PR permission off): a later idea.
- Merge-method settings, such as merge commits only: brain and the other repos keep GitHub's defaults.
- Organization settings: they need the `admin:org` scope, which the login lacks.
- Repos owned by a user, not an organization, and GitHub Enterprise Server.
- Deleting a repo or a branch.
- A filter of environment variables for outside programs: Peter chose none (open question 21).
- Proving the process groups and the limits on Linux: `shared-workflows`, in CI.
- Webhooks instead of polling.

## Prior-art tests

- `packages/cli/src/command/__tests__/run.test.ts`: the sample command `greet`, which calls `gh api user` through `fakeWorld` and checks the outcome and `world.calls`.
- `packages/cli/src/command/__tests__/world.test.ts`: `realWorld` with real `bun -e` programs, a cancel that stops a program within 2 seconds, and a pid file that shows the program is gone.
- brain `scripts/version/__tests__/version-sync.test.ts`: real files in a temp folder, for the local-history check of `ensureRepo` where a test needs a real git repo.

## Success criteria

- [ ] Each step of "The GitHub steps" runs through a sample command with scripted gh and git answers, and gives the result, the progress step and the calls of its cases under "Testing strategy".
- [ ] On a re-run, every step reports skipped when its result is already there, and makes no write.
- [ ] A repo that holds other work, or has the other visibility, ends with exit 2, names the repo, and gets no write.
- [ ] GitHub's answers map to the failure kinds of the table.
- [ ] `realWorld` stops a program, and the programs it started, at its time limit, at its output limit and on a cancel; the limits end with exit 3 and name the limit.
- [ ] `realWorld`'s fetch stops a request at its time limit and a body at its output limit, with exit 3.
- [ ] A call can raise and lower each limit, and the defaults are 5 minutes, 1 minute and 10 MB.
- [ ] No test calls GitHub, and no code reads or prints a token.
- [ ] `spec/README.md` marks open questions 21 and 22 settled, and `spec/SPEC-command-core.md`'s World section matches the code.
- [ ] A changeset records the limits in `@acmelabs/cli`, and `bun run check` is green.

## Open questions

1. Can the Actions setting and Protect main be set at once after a create, and does a push to a just-created repo work at once? UNVERIFIED (note 09, section 3.1). The steps retry an unexpected 404 or 409; `scaffold`'s acceptance run proves the sequence. A probe with a scratch repo in acmelabs-15 would settle it sooner; it creates a repo that the login cannot delete, so it is asked before it runs.
2. Can a poll of the runs list see an old list for up to 60 seconds (`Cache-Control: max-age=60`)? UNVERIFIED. The 2-minute wait for a run to appear covers it.
3. Process groups, SIGKILL after the grace, and the limits on Linux: UNVERIFIED. `shared-workflows` proves them in CI, as it proves `run.bun` (ADR-0012).
4. Does Ctrl+C in a terminal reach a program in its own process group? UNVERIFIED, and not needed: acmelabs gets the Ctrl+C and stops the group itself.
5. Which gh version first has `gh auth status --json`? UNVERIFIED; 2.98.0 has it. An older gh fails `checkLogin` with exit 3 and gh's own message.
