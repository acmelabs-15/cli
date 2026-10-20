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
- [ ] 5. Questions mid-run, and cancel
- [ ] 6. JSON mode's lines
- [ ] 7. The command list and its rules
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
- [ ] `ask` returns an up-front value without calling `answer`; with no value, it calls `answer`; with neither, the outcome is kind `input`, exit 2, naming `--field`.
- [ ] An aborted signal gives kind `cancelled` and exit 130, and open steps close as failed.
- [ ] A type test shows that `ask` accepts only fields of the command's input.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/command`
- [ ] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/cli/src/command/command.ts`, `packages/cli/src/command/run.ts`, `packages/cli/src/command/__tests__/run.test.ts`

**Estimated scope:** Small

## Task 6: JSON mode's lines

**Description:** `progressLine` and `resultLine` build JSON mode's lines in the shapes the spec gives, so `cli-frontend` and the MCP server share them. Each line is one JSON object with a `type`, and the result line carries the outcome.

**Acceptance criteria:**
- [ ] `progressLine` gives a `progress` line for a step update and a `message` line for a message, each with the command's name.
- [ ] `resultLine` gives a `result` line with `ok`, `exitCode`, `durationMs`, and either `result` or `error` with `kind`, `message` and `issues`.
- [ ] Each line is one line of JSON: no line break inside it.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/command`
- [ ] `bun run check` is green.

**Dependencies:** 2, 4

**Files likely touched:** `packages/cli/src/command/lines.ts`, `packages/cli/src/command/__tests__/lines.test.ts`

**Estimated scope:** Small

## Task 7: The command list and its rules

**Description:** `packages/cli/src/commands/index.ts` holds the command list, empty until `repo-checks`. A test checks the list's rules on the real list and on sample lists that break each rule. A changeset says what the frame promises: the exit codes and JSON mode's lines.

**Acceptance criteria:**
- [ ] The rules are tested: unique paths; no path is the start of another; a one-line summary; a description on every input field; every positional names a required field.
- [ ] A test reads each command file's import lines and fails on any import beyond zod, `command-core` and `repo-model`.
- [ ] One changeset for `@acmelabs/cli`, type `minor`, describes the exit codes and JSON mode's lines.

**Verification:**
- [ ] Each test fails first, then passes: `bun test packages/cli/src/commands`
- [ ] `bun run check` is green.

**Dependencies:** 2

**Files likely touched:** `packages/cli/src/commands/index.ts`, `packages/cli/src/commands/__tests__/index.test.ts`, `.changeset/<name>.md`

**Estimated scope:** Small

## Checkpoint: command-core complete

- [ ] Every success criterion in `spec/SPEC-command-core.md` passes.
- [ ] The Definition of Done holds for the module.
- [ ] `/brain:review` on the module's commits, then Peter's choice on the PR into `main`.
