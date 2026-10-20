# Implementation plan — command-core

Status: **approved by Peter on 2026-10-20** through the three plan questions (size right, edges right, no merge or split). Written from `spec/SPEC-command-core.md`, approved on 2026-10-20. Words follow `CONTEXT.md`. The task details, with acceptance criteria and checks, are in `tasks/todo.md`.

## Overview

`command-core` is the frame every command uses: the outside world as one object, a command's declaration and its ending, input errors, progress, questions mid-run, JSON mode's lines, and the command list. Seven tasks, each a vertical slice that leaves `bun run check` green, built on branch `command-core` and merged into `main` through one PR.

| Phase | Tasks | Ends at |
|---|---|---|
| 1. A command runs | 1–3 | Checkpoint: a sample command runs through `runCommand` with `fakeWorld`, and ends with the right exit code |
| 2. The rest of the frame | 4–7 | Checkpoint: every success criterion in the spec passes; `/brain:review`; PR into `main` |

## Architecture decisions

The spec settles the interface. These are the plan's own calls; each is small and reversible.

| Decision | Reason |
|---|---|
| `World` comes first, alone. | Every later task's tests use `fakeWorld`, so it must exist and be trusted first. |
| Task 2 builds `Command`, the failure kinds and a first `runCommand` together. | None of the three can be tested alone: the smallest proof is a sample command that runs and ends with an exit code. |
| Sample commands live only in tests. | The real command list stays empty until `repo-checks`. |
| The command list's import rule is checked by a test that reads each command file's import lines. | The rule keeps quick commands quick; a test catches a heavy import before review does. |
| One changeset, in task 7, says what the frame promises: the exit codes and JSON mode's lines. | That promise is user-facing, though no command uses it yet. |

## Order of work

```
1 World: realWorld and fakeWorld
└── 2 A command runs and ends with its exit code
    ├── 3 Input errors named by flag and positional
    ├── 4 Progress updates, and open steps closed on a throw
    │   └── 6 JSON mode's lines
    ├── 5 Questions mid-run, and cancel
    └── 7 The command list and its rules
```

Tasks 3, 4, 5 and 7 each need only task 2. Task 6 also needs task 4's progress types.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Typing `context.ask` so that only optional input fields can be asked may fight zod's inferred types | Medium | Task 5 starts with a type test; if the precise type costs more than it gives, the task narrows it and says so in its report. |
| A real `spawn` in `realWorld` behaves differently from `fakeWorld` | Low | Task 1 tests `realWorld` against one real, harmless command (`bun --version`) beside the fake. |

## Open questions

None block this plan. The spec's two open questions belong to `agent-guide` and `scaffold`.
