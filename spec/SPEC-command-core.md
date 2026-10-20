# Spec: command-core

Module `command-core`, layer 1 of the capability map (`spec/README.md`). It depends on no other module; `repo-model` errors map onto it through a plain `instanceof` check. Words follow `CONTEXT.md`. Status: approved by Peter on 2026-10-20, exit code 70 included.

## Objective

Define once how a command is declared, how it runs, what it reports while it runs, and how it ends. Every front-end reads that one declaration: CLI mode and JSON mode (`cli-frontend`), the TUI (`tui-app`), the MCP server and the generated skill (`agent-guide`). A new command is one file and one line in the command list, with its own tests (decision 8 of the brief; ADR-0007).

The users are the authors of later commands (`repo-checks`, `marketplace-add`, `upgrade`, `scaffold`), the front-end modules, and the agents and scripts that read JSON mode's lines and the exit codes.

Acceptance: see "Success criteria".

## Settled before this spec

| Decision | Source |
|---|---|
| One command list feeds every front-end; a command prompts only in a terminal, and a missing input there is an error that names its flag | ADR-0007 |
| JSON mode prints one JSON line per progress update, then the final answer as the last line, typed `result`, as Claude Code's `stream-json` does | ADR-0007; interview "JSON mode and progress" |
| Exit codes: 0 done; 1 problem found; 2 bad input or config; 3 an outside tool or service failed; 4 a login is needed; 130 cancelled by the user | ADR-0007; interview "Exit codes" |
| zod 4 schemas, which the router reads through Standard Schema | ADR-0009; `spec/SPEC-repo-model.md` |
| The command seam: a test runs one command with typed input, a temp-folder repo and fakes for the outside world, then checks the result and the progress | `spec/README.md`, "Test seams" |

## A command

```ts
// packages/cli/src/command/command.ts
export type Command<Input extends z.ZodObject, Result> = {
  /** The words that call it, such as ["version", "sync"]. */
  path: readonly string[];
  /** One line for the help, the TUI's menu and the agent guide. */
  summary: string;
  /** Every input, each field described with `.describe()`. Feeds the flags, the prompts and the MCP tool schema. */
  input: Input;
  /** The input fields given by position, in order, such as ["name"] for `acmelabs new <name>`. */
  positionals?: readonly (keyof z.infer<Input> & string)[];
  run: (input: z.infer<Input>, context: Context<z.infer<Input>>) => Promise<Result>;
};

export function defineCommand<Input extends z.ZodObject, Result>(
  command: Command<Input, Result>,
): Command<Input, Result>;
```

- **Prompts come from the input's types**, so a command declares no prompt: a string is a text prompt, an enum a select, an array of an enum a multi-select, a boolean a yes/no question. The front-ends build them.
- **A question mid-run is an input too.** A command declares it as an optional field, and calls `context.ask("field")` when the moment comes. If the caller gave the value up front, `ask` returns it. Otherwise a front-end with a terminal asks, and every other front-end fails with exit 2, naming the flag. So every question has a flag, as ADR-0007 requires. Example: `scaffold` declares `marketplace?: boolean` and asks it once the latest tag exists.
- **Positional data stays out of zod metadata**, because zod copies metadata into the JSON schema that the MCP server sends.

## The context a command runs in

```ts
export type World = {
  /** The repo folder the command acts on; the working folder by default. */
  root: string;
  env: Readonly<Record<string, string | undefined>>;
  spawn: (commandLine: readonly string[], options?: { cwd?: string; stdin?: string }) => Promise<Spawned>;
  fetch: typeof globalThis.fetch;
  now: () => Date;
};
export type Spawned = { code: number; stdout: string; stderr: string };

export type Context<Input> = World & {
  /** Reports one progress update to the front-end. */
  progress: (update: ProgressUpdate) => void;
  /** The value of an optional input: given up front, asked in a terminal, or an input error. */
  ask: <Field extends keyof Input & string>(field: Field) => Promise<NonNullable<Input[Field]>>;
  /** Aborted when the user cancels (Ctrl+C). */
  signal: AbortSignal;
};
```

- **Commands reach the outside world only through `World`.** No command calls `Bun.spawn`, `fetch` or `process.env` itself. That makes the outside world one fake in tests (the command seam), and it keeps every outside call visible.
- Files are not in `World`: commands use Bun's file APIs on paths under `root`, and tests use real files in a temp folder, as brain's tests do.
- `realWorld()` builds the real one; `fakeWorld(options)` builds a fake with scripted `spawn` and `fetch` answers and a log of every call. Both live in `packages/cli/src/command/world.ts`, so later modules' tests use the same fake.

## Progress updates

```ts
export type ProgressUpdate =
  | { kind: "step"; step: string; title: string; status: "started" | "done" | "failed" | "skipped"; detail?: string }
  | { kind: "message"; level: "info" | "warning"; text: string };
```

A step has a stable id (`create-repo`) and a title for people ("Create the GitHub repo"). Every started step ends as done, failed or skipped before the command ends; `runCommand` closes any open step as failed when the command throws.

## How a command ends

```ts
export type Outcome<Result> =
  | { ok: true; command: string; exitCode: 0; durationMs: number; result: Result }
  | { ok: false; command: string; exitCode: ExitCode; durationMs: number; error: CommandFailure };
export type CommandFailure = { kind: FailureKind; message: string; issues: Issue[] };
export type Issue = { field: string; message: string };
```

| Kind | Exit code | When | Thrown by the command as |
|---|---|---|---|
| `problem` | 1 | the command ran and found a problem: version drift, a failed validator | `problem(message, issues?)` |
| `input` | 2 | bad input, a bad `acmelabs.json`, an unanswered question | `inputError(...)`; `runCommand` also maps zod input errors and `RepoConfigError` here |
| `outside` | 3 | an outside tool or service failed, or a required tool is missing | `outsideError(...)` |
| `login` | 4 | a login is needed (gh, npm) | `loginNeeded(service)` |
| `cancelled` | 130 | the user cancelled | `runCommand`, when `signal` aborts |
| `bug` | 70 | anything else thrown: a defect in acmelabs itself | `runCommand` |

**For Peter's review:** the agreed codes have no case for a defect inside acmelabs. This spec proposes 70, the standard "internal software error" code (`EX_SOFTWARE` in BSD's sysexits), so a bug never looks like "problem found" or "bad input". The message asks the user to report it.

An input issue names the field as the caller wrote it: `--host` for a flag, `<name>` for a positional, and the field path inside `acmelabs.json` for a repo config issue.

```ts
/** Runs one command: checks the input, runs it, and turns every ending into an Outcome. */
export function runCommand<Input extends z.ZodObject, Result>(
  command: Command<Input, Result>,
  rawInput: unknown,
  host: { world: World; progress: (update: ProgressUpdate) => void; answer?: Answerer; signal: AbortSignal },
): Promise<Outcome<Result>>;
```

`runCommand` is the command seam. `answer` is how a front-end with a terminal asks a question; JSON mode and the MCP server pass none.

## JSON mode's lines

The shapes of JSON mode's lines are defined here, so `cli-frontend` and the MCP server share them. Each line is one JSON object with a `type`:

```json
{"type":"progress","command":"new","step":"create-repo","title":"Create the GitHub repo","status":"started"}
{"type":"message","command":"new","level":"warning","text":"agy is not on PATH; its validator is skipped"}
{"type":"result","command":"version check","ok":false,"exitCode":1,"durationMs":14,"error":{"kind":"problem","message":"2 manifests disagree with package.json","issues":[{"field":".claude-plugin/plugin.json","message":"version is 0.1.0, package.json says 0.2.0"}]}}
```

`progressLine(command, update)` and `resultLine(outcome)` build them. The last line is always the result, as in Claude Code's `stream-json`; a script that wants only the answer reads the last line.

## The command list

```ts
// packages/cli/src/commands/index.ts
export const commands = [versionSync, versionCheck /* , one line per command */] as const;
```

Rules, each checked by a test over the real list:

- Every path is unique, and no command's path is the start of another command's path.
- Every summary is one line, and every input field has a description.
- Every positional names a required field of the input.
- A command file imports only zod, `command-core` and `repo-model` at its top. Anything heavier (gh, npm, the TUI) loads inside `run` with `await import(...)`, so a quick command in CI stays quick.

The list is empty until `repo-checks` adds the first real commands; this module's tests use sample commands.

## Commands

The module adds no `acmelabs` command. Its checks run in the repo's gate: `bun run check`.

## Project structure

```
packages/cli/src/command/command.ts       Command, defineCommand, Context
packages/cli/src/command/world.ts         World, realWorld, fakeWorld
packages/cli/src/command/outcome.ts       the failure kinds, exit codes, the throw helpers
packages/cli/src/command/run.ts           runCommand
packages/cli/src/command/lines.ts         progressLine, resultLine
packages/cli/src/command/__tests__/       one test file per source file
packages/cli/src/commands/index.ts        the command list
packages/cli/src/commands/__tests__/index.test.ts   the list's rules
```

## Code style

As in `repo-model`: `type` for shapes, functions inside a type written as properties (`spawn: (...) => ...`, as Ultracite's `method-signature-style` rule requires), function declarations with helpers above their callers, a one-line doc comment per export, Bun APIs, 100 columns, trailing commas. A command file reads like this:

```ts
export const versionCheck = defineCommand({
  path: ["version", "check"],
  summary: "Fail when a manifest's version disagrees with package.json.",
  input: z.object({}),
  async run(_input, context) {
    const drifted = await findDrift(context.root);
    if (drifted.length > 0) {
      throw problem(`${drifted.length} manifests disagree with package.json`, drifted);
    }
    return { checked: manifestCount };
  },
});
```

## Testing strategy

The command seam (`spec/README.md`): tests call `runCommand` with a sample command, typed input, a temp folder as `root`, and `fakeWorld`, then check the `Outcome` and the progress updates. Prior-art tests: brain's `version-sync.test.ts` (temp folders, real files) and this repo's `config.test.ts` (exact issue lists).

Cases: a success; each failure kind with its exit code; zod input errors named by flag and by positional; a `RepoConfigError` mapped to kind `input` with its issues; an `ask` answered up front, answered by an `answer` function, and unanswered with no `answer` (exit 2, naming the flag); cancel through the signal (130); an open step closed as failed on a throw; a thrown non-command error (70); `progressLine` and `resultLine` shapes; `fakeWorld` records spawn and fetch calls and returns scripted answers; the command list's rules on sample lists that break each rule.

## Boundaries

- **Always:** a command ends only through `runCommand`, so every ending has an exit code from the table.
- **Always:** commands reach the outside world only through `World`.
- **Ask first:** adding a failure kind or an exit code, or changing a JSON line's shape. Agents and CI depend on both.
- **Never:** a prompt outside `context.ask` and the front-ends; a command never writes to the terminal itself.

## User stories

1. As a command's author, I want to declare a command in one file with its inputs and a run function, so that every front-end gets it from one place.
2. As a command's author, I want to register a command with one line in the command list, so that adding a command touches nothing else.
3. As a command's author, I want prompts built from my input's types, so that I write no prompt code.
4. As a command's author, I want to ask a question mid-run with `context.ask`, so that the question appears when it makes sense, and still has a flag.
5. As a command's author, I want throw helpers for each failure kind, so that I never pick an exit code by hand.
6. As a command's author, I want the outside world in `World`, so that my tests script gh, npm and the network with one fake.
7. As a command's author, I want progress updates with step ids and titles, so that every front-end shows the same steps.
8. As an agent, I want every JSON line typed, and the result last, so that I can follow progress and read the answer the same way every time.
9. As a script in CI, I want one exit code per failure mode, so that I can retry an outside failure and fail fast on bad input.
10. As a script, I want a bad flag reported by its flag name, so that I can fix the call without reading code.
11. As a user who presses Ctrl+C, I want exit 130 and no half-finished step reported as done, so that I know where the command stopped.
12. As a maintainer, I want a defect in acmelabs to exit with its own code, so that a bug never looks like a problem in my repo.
13. As a maintainer, I want a bad `acmelabs.json` reported with its file and field, as `repo-model` gives them, so that one fix list holds every issue.
14. As the `cli-frontend` module, I want each input's type, description and position, so that I can build the router's flags and the help.
15. As the `tui-app` module, I want the same declarations, so that the TUI's forms match CLI mode's prompts.
16. As the `agent-guide` module, I want each command's input as a JSON schema, so that the MCP server's tools and the skill match the CLI.
17. As a maintainer, I want quick commands to load no heavy code, so that CI checks stay fast.
18. As a reviewer, I want the command list's rules checked by a test, so that a new command cannot break help or routing.

## Out of scope

- Parsing arguments, help text, CLI mode's prompts and their theme, writing lines to the terminal: `cli-frontend`.
- The TUI's forms and screens: `tui-app`. The MCP server and the skill: `agent-guide`.
- Any real command: `repo-checks` adds the first ones.

## Success criteria

- [ ] `defineCommand` and `runCommand` exist as the interface above, and a sample command runs through `runCommand` with `fakeWorld`.
- [ ] Every failure kind ends with its exit code: 1, 2, 3, 4, 130 and 70.
- [ ] Input errors name the flag or positional; a `RepoConfigError` keeps its file and field issues.
- [ ] `context.ask` returns an up-front value, uses `answer` when given, and otherwise fails with exit 2 naming the flag.
- [ ] Every started step is closed before the outcome; a throw closes open steps as failed.
- [ ] `progressLine` and `resultLine` give the shapes above, and the result line is the last one.
- [ ] The command list's rules are tested, on the real list and on sample lists that break each rule.
- [ ] `bun run check` is green.

## Open questions

1. How the MCP server maps progress updates onto MCP progress notifications: `agent-guide`.
2. Whether a long command's progress also goes to a log file for later reading: decide with `scaffold`, the first long command.
