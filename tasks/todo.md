# Tasks — command-core

The task list for `tasks/plan.md`. Tick a task in the checklist, and each box inside its section, when it meets its acceptance criteria and the Definition of Done (brain's `references/definition-of-done.md`). Each task ends with `bun run check` green and one commit on branch `command-core`, pushed.

## Checklist

Phase 1 A command runs

- [x] 1. World: realWorld and fakeWorld
- [x] 2. A command runs and ends with its exit code
- [x] 3. Input errors named by flag and positional
- [x] Checkpoint: a command runs

Phase 2 The rest of the frame

- [x] 4. Progress updates, and open steps closed on a throw
- [x] 5. Questions mid-run, and cancel
- [x] 6. JSON mode's lines
- [x] 7. The command list and its rules
- [x] 8. Review fixes: secrets redacted, the progress sink guarded, a missing program exits 3, one shared helper
- [x] 9. Review fixes: the front-end types in command.ts, and run.ts split into input, steps and run
- [x] 10. Review fixes: list rules apart, descriptions through wrappers, nits, glossary and spec records
- [ ] Checkpoint: command-core complete

## Task 1: World: realWorld and fakeWorld

**Description:** The outside world becomes one object, `World`, so a command reaches gh, npm and the network only through it, and a test replaces it with one fake. `realWorld()` uses Bun and the process; `fakeWorld()` answers `spawn` and `fetch` from a script and logs every call.

**Acceptance criteria:**
- [x] `World`, `Spawned`, `realWorld()` and `fakeWorld(options)` exist in `packages/cli/src/command/world.ts`, as the spec's "The context a command runs in" gives them.
- [x] `fakeWorld` returns the scripted answer for a matching `spawn` or `fetch` call, fails loudly on an unscripted call, and logs every call in order.
- [x] `realWorld().spawn(["bun", "--version"])` returns code 0 and Bun's version on stdout.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** None

**Files likely touched:** `packages/cli/src/command/world.ts`, `packages/cli/src/command/__tests__/world.test.ts`

**Estimated scope:** Small

## Task 2: A command runs and ends with its exit code

**Description:** A command is declared with `defineCommand`, and `runCommand` runs it and turns every ending into an `Outcome` with an exit code. The failure kinds and their throw helpers exist. This is the command seam.

**Acceptance criteria:**
- [x] `Command`, `defineCommand`, `Context`, `Outcome`, the failure kinds with their exit codes (problem 1, input 2, outside 3, login 4, cancelled 130, bug 70), and the helpers `problem`, `inputError`, `outsideError` and `loginNeeded` exist, as the spec gives them.
- [x] A sample command run through `runCommand` with `fakeWorld` gives `ok: true`, exit 0, its result and a duration.
- [x] Each helper's throw gives its kind and exit code, and any other thrown error gives kind `bug` and exit 70, with a message that asks the user to report it.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** 1

**Files likely touched:** `packages/cli/src/command/command.ts`, `packages/cli/src/command/outcome.ts`, `packages/cli/src/command/run.ts`, `packages/cli/src/command/__tests__/run.test.ts`

**Estimated scope:** Medium

## Task 3: Input errors named by flag and positional

**Description:** Bad input ends with kind `input` and exit 2, and each issue names the field as the caller wrote it: `--host` for a flag, `<name>` for a positional. A `RepoConfigError` from `repo-model` ends the same way, with its file and field issues kept.

**Acceptance criteria:**
- [x] A zod input error gives one issue per field, named `--flag-name` (kebab case of the field) or `<field>` for a positional.
- [x] A `RepoConfigError` thrown inside `run` gives kind `input`, exit 2, and its issues with their `acmelabs.json` field paths.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/cli/src/command/run.ts`, `packages/cli/src/command/__tests__/run.test.ts`

**Estimated scope:** Small

## Checkpoint: a command runs

- [x] A sample command runs through `runCommand` with `fakeWorld`, and every failure kind built so far ends with its exit code.
- [x] `bun run check` is green on a clean clone of the branch.

## Task 4: Progress updates, and open steps closed on a throw

**Description:** A command reports progress with `context.progress`, and `runCommand` forwards each update to the front-end in order. A step that started and did not end is closed as failed when the command throws, so no front-end shows a half-done step as running.

**Acceptance criteria:**
- [x] `ProgressUpdate` exists as the spec gives it, and updates reach the front-end's `progress` in order.
- [x] A throw closes each open step as `failed` before the outcome; a normal end with an open step is a bug (kind `bug`, exit 70), because every started step must end.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/cli/src/command/command.ts`, `packages/cli/src/command/run.ts`, `packages/cli/src/command/__tests__/run.test.ts`

**Estimated scope:** Small

## Task 5: Questions mid-run, and cancel

**Description:** `context.ask(field)` returns an optional input's value: the value given up front, else the answer from the front-end's `answer` function, else an input error that names the flag. Cancel through the front-end's signal ends with kind `cancelled` and exit 130.

**Acceptance criteria:**
- [x] `ask` returns an up-front value without calling `answer`; with no value, it calls `answer`; with neither, the outcome is kind `input`, exit 2, naming `--field`.
- [x] An aborted signal gives kind `cancelled` and exit 130, and open steps close as failed.
- [x] A type test shows that `ask` accepts only fields of the command's input.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/cli/src/command/command.ts`, `packages/cli/src/command/run.ts`, `packages/cli/src/command/__tests__/run.test.ts`

**Estimated scope:** Small

## Task 6: JSON mode's lines

**Description:** `progressLine` and `resultLine` build JSON mode's lines in the shapes the spec gives, so `cli-frontend` and the MCP server share them. Each line is one JSON object with a `type`, and the result line carries the outcome.

**Acceptance criteria:**
- [x] `progressLine` gives a `progress` line for a step update and a `message` line for a message, each with the command's name.
- [x] `resultLine` gives a `result` line with `ok`, `exitCode`, `durationMs`, and either `result` or `error` with `kind`, `message` and `issues`.
- [x] Each line is one line of JSON: no line break inside it.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/command`
- [x] `bun run check` is green.

**Dependencies:** 2, 4

**Files likely touched:** `packages/cli/src/command/lines.ts`, `packages/cli/src/command/__tests__/lines.test.ts`

**Estimated scope:** Small

## Task 7: The command list and its rules

**Description:** `packages/cli/src/commands/index.ts` holds the command list, empty until `repo-checks`. A test checks the list's rules on the real list and on sample lists that break each rule. A changeset says what the frame promises: the exit codes and JSON mode's lines.

**Acceptance criteria:**
- [x] The rules are tested: unique paths; no path is the start of another; a one-line summary; a description on every input field; every positional names a required field.
- [x] A test reads each command file's import lines and fails on any import beyond zod, `command-core` and `repo-model` (Node built-ins were added after a load-time measurement; see the spec).
- [x] One changeset for `@acmelabs/cli`, type `minor`, describes the exit codes and JSON mode's lines.

**Verification:**
- [x] Each test fails first, then passes: `bun test packages/cli/src/commands`
- [x] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/cli/src/commands/index.ts`, `packages/cli/src/commands/__tests__/index.test.ts`, `.changeset/<name>.md`

**Estimated scope:** Small

## Task 8: Review fixes: secrets redacted, the progress sink guarded, a missing program exits 3, one shared helper

**Description:** Fix the review's Required findings 1 to 4 (`docs/reviews/2026-10-20-command-core.md`), chosen by Peter on 2026-10-20.

**Acceptance criteria:**
- [x] Every text that leaves `runCommand` (failure and issue messages, progress titles, details and messages) has secrets removed: the value of every `world.env` entry whose name holds `TOKEN`, `SECRET`, `KEY` or `PASSWORD`, URL credentials, and token-like query values; a thrown `new Error("https://x?token=abc")` leaves no `abc` in the outcome (finding 1).
- [x] A front-end whose `progress` throws cannot make `runCommand` reject: the outcome still comes, with its exit code (finding 2).
- [x] A program that is not installed ends with kind `outside`, exit 3, and a message that names the program, from `realWorld` and from `fakeWorld`; one shared helper replaces `sameWords` and `samePath` (findings 3 and 4).

**Verification:**
- [x] Each new test fails first, then passes: `bun test packages/cli/src`
- [x] `bun run check` is green, by its own exit code.

**Dependencies:** 7

**Files likely touched:** `packages/cli/src/command/run.ts`, `world.ts`, `list.ts`, and their tests

**Estimated scope:** Medium

## Task 9: Review fixes: the front-end types in command.ts, and run.ts split into input, steps and run

**Description:** Fix the review's finding 5, chosen by Peter on 2026-10-20, before any front-end imports these types. A pure move: no behaviour changes, and every test still passes.

**Acceptance criteria:**
- [x] `FrontEnd`, `Question` and `Answerer` live in `command.ts` beside `Context`.
- [x] Flag naming and the input and answer checks live in `input.ts`, the step tracker in `steps.ts`, and `run.ts` holds `runCommand` and what only it uses.
- [x] The tests are split the same way, and the count of tests is the same before and after.

**Verification:**
- [x] `bun run check` is green, by its own exit code, with the same number of tests as before the task.

**Dependencies:** 8

**Files likely touched:** `packages/cli/src/command/command.ts`, `run.ts`, `input.ts`, `steps.ts`, and the tests under `__tests__/`

**Estimated scope:** Medium (a move across several files)

## Task 10: Review fixes: list rules apart, descriptions through wrappers, nits, glossary and spec records

**Description:** Fix the review's findings 6 to 8 and 11 to 18, chosen by Peter on 2026-10-20, and mark every finding's outcome in the review file.

**Acceptance criteria:**
- [x] The command list's rules live apart from `CommandList`; a description is found through optional, nullable and default wrappers, in the rules and in a `Question`; an empty path and an async schema are handled; `trackSteps` reads with less nesting (findings 6, 7, 8, 15, 16).
- [x] The nits are fixed: the comments and `questionFor` (12, 13); the glossary gains World, Outcome, Failure kind and Progress update, and one word replaces "defect" and "bug" for one concept (14).
- [x] The spec records: the reworded doc-comment rule, its first line on `repo-model`, the step-restart rule and the line escaping (11, 17, 18); the review file marks each finding's outcome.

**Verification:**
- [x] Each behaviour change gets a failing test first: `bun test packages/cli/src`
- [x] `bun run check` is green, by its own exit code.

**Dependencies:** 9

**Files likely touched:** `packages/cli/src/command/list.ts`, a new rules file, `run.ts` or its split files, their tests, `CONTEXT.md`, `spec/SPEC-command-core.md`, `docs/reviews/2026-10-20-command-core.md`

**Estimated scope:** Medium (many files, small edits)

## Checkpoint: command-core complete

- [ ] Every success criterion in `spec/SPEC-command-core.md` passes.
- [ ] The Definition of Done holds for the module.
- [ ] `/brain:review` on the module's commits, then Peter's choice on the PR into `main`.
