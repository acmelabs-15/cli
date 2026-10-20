# Review: the command-core module

The final-checkpoint review of module `command-core` (`/brain:review`, the five-axis review of `code-review-and-quality`), run on 2026-10-20 before the module's PR into `main`.

**Verdict: request changes.** The spec is met: every success criterion has code and a test, and the changes made during the build are recorded. Four Required findings stand, one of them a security finding.

## Context

| Item | Value |
|---|---|
| Fixed point | merge-base `20a99c1` (the spec's approval on `main`); diff `git diff 20a99c1...HEAD`; 18 commits, 22 files, about 1,000 lines of source and 2,150 lines of tests |
| Spec | `spec/SPEC-command-core.md`, with the changes recorded on the branch |
| Standards | `AGENTS.md`, `CLAUDE.md`, `spec/README.md`, the spec's "Code style" and "Boundaries", ADR-0007, ADR-0009, `oxlint.config.ts`, `oxfmt.config.ts`, `CONTEXT.md` |
| Axes | correctness, readability, architecture, security, performance: five parallel sub-agents on Sonnet; plus the orchestrator's own read of `run.ts` and the tests |

## Verification story

- `bun run check` is green by its own exit code: 151 tests. Each task was built test-first by a fresh sub-agent and verified again by the orchestrator.
- The checkpoint "a command runs" passed on a clean clone of the branch.
- A real program (`bun -e`) is stopped by a cancel within 2 seconds; mutation checks proved that each guard in the step tracker, `ask` and cancel has a test that fails without it.
- One slip: commit `ee74078` went in with the format check red (a pipe hid the gate's exit code); `f244480` fixed it and `AGENTS.md` now names the gotcha.

## Findings, ranked by leverage

### Required

1. **A bug message can carry a secret into logs.** `[judgement]` (security)
   `packages/cli/src/command/run.ts:299-303`, `failureOf`: `acmelabs hit a bug: ${text}`. The text is any thrown error's message: a fetch error holds the full URL, a token in its query included. The message goes into the result line and CI logs, and asks the reader to paste it into a public issue.
   Fix: one redaction step in `runCommand` for every text that leaves it (failure and issue messages, progress titles, details and messages): remove the value of every `world.env` entry whose name matches `TOKEN`, `SECRET`, `KEY` or `PASSWORD`, URL credentials (`://user:pass@`), and token-like query values. A test throws `new Error("https://x?token=abc")` and checks that `abc` is absent from the outcome.

2. **A throwing progress sink makes `runCommand` reject.** `[hard: spec/SPEC-command-core.md, Boundaries: "a command ends only through runCommand, so every ending has an exit code"]` (correctness)
   `run.ts:196-202` and `:369`: `closeAsFailed` sends to `frontEnd.progress` inside the `catch`. If the front-end throws (a broken pipe), the error escapes `runCommand`.
   Fix: guard the sends in `closeAsFailed`, so a front-end's failure cannot escape; test it.

3. **A program that is not installed ends as a bug, not as an outside failure.** `[judgement]` (correctness)
   `packages/cli/src/command/world.ts`, `realWorld().spawn`: `Bun.spawn` throws when the program is missing, so the command ends with exit 70, unless every command catches it. The spec's table puts "a required tool is missing" under `outside`, exit 3.
   Fix: `realWorld().spawn` rejects with an outside failure that names the program, for example `claude is not installed or not on PATH`; `fakeWorld` can script it; test both.

4. **One helper, written twice.** `[judgement]` (readability, architecture)
   `world.ts:117` `sameWords` and `packages/cli/src/command/list.ts:24` `samePath` have the same body: two word lists with the same words in the same order.
   Fix: one shared helper, used by both.

### Optional

5. **`run.ts` holds five jobs, and front-ends must import the runner for their types.** `[judgement]` (architecture, readability, orchestrator)
   `run.ts` holds flag naming (`flagOf`, `fieldOf`), input and answer checks, the step tracker, the context, failure mapping and the abort race, in 383 lines; `run.test.ts` is 1,334 lines. `FrontEnd`, `Question` and `Answerer` live in `run.ts:11-36`, so `cli-frontend` and `tui-app` would import the runner file to implement them; a later move would break them.
   Fix: before any front-end imports them, move `FrontEnd`, `Question` and `Answerer` beside `Context` in `command.ts`; move flag naming and input checks to `input.ts`, and the step tracker to `steps.ts`; split the tests the same way.

6. **The command list's rules sit with its type.** `[judgement]` (architecture, readability)
   `list.ts:118-140` (`light`, `heavyImports`, `Bun.Transpiler`) and `commandListProblems` are test-time rules; `CommandList` is the type every front-end reads.
   Fix: move the rules to `list-rules.ts`, so the published package does not carry a source scanner.

7. **A description given before `.optional()` is not found.** `[judgement]` (correctness)
   `list.ts:68-73` and `run.ts:256` read `schema.description`, so `z.string().describe("x").optional()` counts as undescribed, and its `Question` has no description; the MCP schema still shows it.
   Fix: read the description through the optional, nullable and default wrappers, in both places; test both orders.

8. **`trackSteps.progress` nests a four-way branch.** `[judgement]` (readability)
   `run.ts:166-183`. Fix: send a non-step update early, then one `if` for `started`.

9. **Child programs inherit every environment variable.** `[judgement]` (security)
   `world.ts`, `Bun.spawn` sets no `env`, so every validator runs with `GH_TOKEN` and `NPM_TOKEN`.
   Fix: decide with `github-ops` and `repo-checks`, which know what each program needs; an allowlist risks breaking a tool that needs a proxy or certificate variable.

10. **No size or time limit on an outside program or request.** `[judgement]` (security)
    `world.ts`: `stdout.text()` and `stderr.text()` read without limit; `fetch` has only the cancel signal. A hostile pull request could stall or flood CI.
    Fix: decide with `github-ops` and `shared-workflows`: a byte cap that stops the program, and a default time limit a command can override.

### Nit

11. The spec's style rule "a one-line doc comment per export" reads as "at most one line", which the code of both modules does not follow. `[judgement]` (readability) Fix: reword the rule to what it means: every export has a doc comment whose first line says what it is.
12. `run.ts:372`: the reason a kept step defect wins over a later failure lives only in `trackSteps`; add one comment at the `catch`. `[judgement]` (readability)
13. `run.ts:245-269`: `ask` builds its question inline; extract `questionFor(schema, field)`. `[judgement]` (readability)
14. The glossary lacks World, Outcome, Failure kind and Progress update, and the code says both "defect" and "bug" for one concept. `[judgement]` (readability) Fix: through the domain-modeling skill; pick one word.
15. `list.ts:32-34`: an empty command path passes the rules. `[judgement]` (correctness) Fix: a path has one word or more.
16. `list.ts:79-81`: `mayLeaveOut` uses `safeParse`, which throws on an async schema. `[judgement]` (correctness) Fix: `safeParseAsync`.
17. The spec's first line says the module "depends on no other module", but it maps `RepoConfigError` from `repo-model`. `[judgement]` (architecture) Fix: say it depends on `repo-model` for that one error.
18. Two behaviours the build added are not in the spec: a step started again while open is a bug, and JSON mode's lines also escape DEL, the C1 controls, U+2028 and U+2029. `[judgement]` (correctness, scope creep) Fix: keep both, because each protects a promise the spec makes (no step shown twice; one line per line), and record them in the spec.

### FYI

19. Open question 19 is now live: a parse error that quotes a linked `acmelabs.json` reaches JSON mode's lines through `failureOf`. It must be settled before `repo-checks` ships a command that reads the config. (security)
20. After a cancel, the command's own file writes may go on; only `spawn` and `fetch` get the signal. Documented in the code; the spec could say it. (correctness)
21. `cli-frontend` will need one "what kind of field is this" helper for its prompts; `isBoolean` and `mayLeaveOut` ask it two other ways today. (architecture)
22. `fakeWorld` ships in `world.ts` beside `realWorld`, as the spec requires so later modules' tests share it. (architecture)
23. Importing `run.ts` costs about 17-22 ms, nearly all zod; `bun run check` takes about 2 s; `writable` and `resultLine` write a result as JSON twice; one `{ once: true }` abort listener per run is removed when the run ends. (performance)
24. Test gaps the fixes should close: an `answer` that resolves after a cancel; a throwing progress sink; a program that is not installed. (correctness)

## Checked and clean

- `spawn` takes a word list and no shell is involved; JSON mode's lines escape every control character; no secret is logged by the module's own text. (security)
- Dependencies flow one way (`command` to `repo`, never back); no import cycle; `defineCommand` is the spec's typing seam, not speculative. (architecture)
- Every success criterion and test case in the spec has code and a test; the recorded spec changes match the spec as it stands. (correctness)
- No timers, no leaked listeners, no unbounded loop in the run path. (performance)
