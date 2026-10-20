# Spec: command-core

Module `command-core`, layer 1 of the capability map (`spec/README.md`). It depends on `repo-model` for one thing, `RepoConfigError`, which `runCommand` maps to kind `input` through a plain `instanceof` check. Words follow `CONTEXT.md`. Status: approved by Peter on 2026-10-20, exit code 70 included.

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
export type Command<Input extends z.ZodObject, Result extends Json> = {
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

export function defineCommand<Input extends z.ZodObject, Result extends Json>(
  command: Command<Input, Result>,
): Command<Input, Result>;
```

- **A result is JSON** (`Json`, below), because JSON mode's result line carries it. A bigint, a function, a `Date` or no result at all is a type error. A result that gets past the type, such as one with a cycle, ends as a bug (exit 70), so exit 0 always comes with a result line.
- **Prompts come from the input's types**, so a command declares no prompt: a string is a text prompt, an enum a select, an array of an enum a multi-select, a boolean a yes/no question. The front-ends build them.
- **A question mid-run is an input too.** A command declares it as an optional field, and calls `context.ask("field")` when the moment comes. If the caller gave the value up front, `ask` returns it. Otherwise a front-end with a terminal asks, and every other front-end fails with exit 2, naming the flag. So every question has a flag, as ADR-0007 requires. Once the user cancels, `ask` asks nothing more, and an answer that comes after the cancel is not used. Example: `scaffold` declares `marketplace?: boolean` and asks it once the latest tag exists.
- **Positional data stays out of zod metadata**, because zod copies metadata into the JSON schema that the MCP server sends.

## The context a command runs in

```ts
/** The limits that every outside program and request gets unless the call changes them. */
export const limits = {
  programMs: 5 * 60 * 1000,
  requestMs: 60 * 1000,
  outputBytes: 10 * 1024 * 1024,
} as const;

export type SpawnOptions = {
  cwd?: string;
  stdin?: string;
  signal?: AbortSignal;
  /** Variables added to the environment the program gets; one here replaces one of the same name. */
  env?: Readonly<Record<string, string>>;
  /** The program's time limit in milliseconds: `limits.programMs` when unset. */
  timeoutMs?: number;
  /** The program's output limit in bytes, for stdout and stderr each: `limits.outputBytes` when unset. */
  maxOutputBytes?: number;
};

/** A request's options: fetch's own, and its limits. */
export type FetchInit = RequestInit & {
  /** The request's time limit in milliseconds, to the end of its body: `limits.requestMs` when unset. */
  timeoutMs?: number;
  /** The most bytes of the response body: `limits.outputBytes` when unset. */
  maxBodyBytes?: number;
};

export type World = {
  /** The repo folder the command acts on; the working folder by default. */
  root: string;
  env: Readonly<Record<string, string | undefined>>;
  spawn: (commandLine: readonly string[], options?: SpawnOptions) => Promise<Spawned>;
  fetch: (input: string | URL | Request, init?: FetchInit) => Promise<Response>;
  now: () => Date;
};
export type Spawned = { code: number; stdout: string; stderr: string };

export type Context<Input> = World & {
  /** Reports one progress update to the front-end. */
  progress: (update: ProgressUpdate) => void;
  /** The value of an optional input: given up front, asked in a terminal, or an input error. */
  /** Only the optional input fields: a required field always has a value once the input is checked. */
  ask: <Field extends OptionalField<Input>>(field: Field) => Promise<NonNullable<Input[Field]>>;
  /** Aborted when the user cancels (Ctrl+C). */
  signal: AbortSignal;
};
```

- **Commands reach the outside world only through `World`.** No command calls `Bun.spawn`, `fetch` or `process.env` itself. That makes the outside world one fake in tests (the command seam), and it keeps every outside call visible.
- **`spawn` and `fetch` take the run's signal.** `spawn`'s options take a `signal`, as `fetch`'s do. `context.spawn` and `context.fetch` pass the context's `signal` unless the command passes its own, so a cancel also stops an outside program or request.
- **An outside program gets the whole environment**, plus the call's `env` (ADR-0015).
- **An outside program runs in its own process group.** At a limit and on a cancel, the World sends SIGTERM to the whole group, then SIGKILL after a grace of 5 seconds, so no program that the outside program started keeps the command waiting. A group that is already gone, or whose programs have all ended, is not an error. Once nothing in the group is left to stop, the World cancels the SIGKILL, so acmelabs can exit at once.
- **An outside program runs under a time limit and an output limit.** The time limit is `limits.programMs`, 5 minutes, unless the call sets `timeoutMs`. The output limit is `limits.outputBytes`, 10 MB, unless the call sets `maxOutputBytes`: the World counts the bytes of stdout and of stderr, each on its own, as it reads them, and output up to the limit stays byte for byte as the program printed it. A limit rejects with an outside failure (exit 3) that names the program and the limit, such as `gh api ... ran longer than 5 minutes and was stopped` or `gh api ... printed more than 10 MB on stdout and was stopped`; a cancel rejects with the signal's reason (`spec/SPEC-github-ops.md`, "The World's limits"). A limit that is not a positive number is a bug in the caller.
- **A request runs under a time limit and a body limit.** `fetch` is a plain function, not Bun's fetch type, so the World copies nothing such as `preconnect`. The time limit is `limits.requestMs`, 1 minute, unless the call sets `timeoutMs`: an `AbortSignal.timeout` beside the call's own signal, which covers the whole answer, its body included. The body limit is `limits.outputBytes`, 10 MB, unless the call sets `maxBodyBytes`: a body whose `Content-Length` is above it is never read, and any other body is counted as the caller reads it, after Bun decompresses it. An answer that HTTP gives no body (to HEAD, a 204 or a 304) passes, whatever its `Content-Length`. A time-out before the response rejects the call, and a time-out during the body, or a body past its limit, rejects the read of the body (`text()`, `json()` or the stream), each with an outside failure (exit 3) that names the method, the URL and the limit, such as `GET https://registry.npmjs.org/@acmelabs%2fcli got no whole answer within 1 minute and was stopped` or `... got a body of more than 10 MB and was stopped`. A network failure is an outside failure (exit 3) too. It is a refused connection, a reset, a DNS or TLS failure, a redirect without end, or a body that cannot be decompressed. It rejects the call, or the read of the body when it comes during the body. Its message names the method, the URL, what failed and Bun's code, such as `GET https://registry.npmjs.org/-/ping failed: the connection was refused (ConnectionRefused)`. On Bun 1.4.0, a network failure is a `TypeError` with a string `code` and the URL as `path`. A caller's bug, such as an invalid URL or header, lacks one of the two. It stays as fetch gives it, and ends as a bug (exit 70). Bun gives three codes the network failure's shape for an outside cause and for the call's own choice alike, so they stay outside failures: `FailedToOpenSocket` (a broadcast address, or port 0), `UnsupportedProxyProtocol` (a proxy from the environment, or the call's) and `UnexpectedRedirect` (a redirect that the call forbids). A cancel rejects with the signal's reason, and wins over the time limit. The message holds the whole URL: `runCommand` removes a secret query value from it, as from every message. The response keeps its status, headers, URL and redirect flag.
- Files are not in `World`: commands use Bun's file APIs on paths under `root`, and tests use real files in a temp folder, as brain's tests do.
- `realWorld(options)` builds the real one; its `graceMs` shortens the grace for a test. `fakeWorld(options)` builds a fake with scripted `spawn` and `fetch` answers and a log of every call, with every spawn option except the signal. A scripted spawn answer can be `missing`, `limit: "time"` or `limit: "output"` (on stdout), which reject with the same outside failures as the real World. A scripted fetch answer can be `limit: "time"`, which rejects the call, or `limit: "output"`, which gives the response and rejects the read of its body, each with the same outside failure as the real World. `realWorld` lives in `packages/cli/src/command/world.ts`, and `fakeWorld` in `fake-world.ts` beside it, so later modules' tests use the same fake.

## Progress updates

```ts
export type ProgressUpdate =
  | { kind: "step"; step: string; title: string; status: "started" | "done" | "failed" | "skipped"; detail?: string }
  | { kind: "message"; level: "info" | "warning"; text: string };
```

A step has a stable id (`create-repo`) and a title for people ("Create the GitHub repo"). Every started step ends as done, failed or skipped before the command ends; `runCommand` closes any open step as failed when the command throws.

A step started again while it is open ends the command as a bug (exit 70), because a front-end would show the step twice. The run keeps that bug, so a command that catches its error, or throws another failure after it, still ends as a bug. A step may start again once it has ended.

## How a command ends

```ts
/** A value JSON holds as it is; an object's field may be undefined, and JSON leaves it out. */
export type Json =
  | string | number | boolean | null
  | readonly Json[]
  | { readonly [field: string]: Json | undefined };
export type Outcome<Result extends Json> =
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
| `bug` | 70 | anything else thrown: a bug in acmelabs itself | `runCommand` |

**For Peter's review:** the agreed codes have no case for a bug inside acmelabs. This spec proposes 70, the standard "internal software error" code (`EX_SOFTWARE` in BSD's sysexits), so a bug never looks like "problem found" or "bad input". The message asks the user to report it.

An input issue names the field as the caller wrote it: `--host` for a flag, `<name>` for a positional, and the field path inside `acmelabs.json` for a repo config issue.

```ts
/** What a front-end gives runCommand: its world, where progress updates go, its signal, and how it asks. */
export type FrontEnd = {
  world: World;
  progress: (update: ProgressUpdate) => void;
  signal: AbortSignal;
  answer?: Answerer;
};

/** Runs one command: checks the input, runs it, and turns every ending into an Outcome. */
export function runCommand<Input extends z.ZodObject, Result extends Json>(
  command: Command<Input, Result>,
  rawInput: unknown,
  frontEnd: FrontEnd,
): Promise<Outcome<Result>>;
```

The parameter is named after the glossary's **front-end**, not "host", which the glossary keeps for an agent program that loads a plugin.

`runCommand` is the command seam. `answer` is how a front-end with a terminal asks a question; JSON mode and the MCP server pass none.

## JSON mode's lines

The shapes of JSON mode's lines are defined here, so `cli-frontend` and the MCP server share them. Each line is one JSON object with a `type`:

```json
{"type":"progress","command":"new","step":"create-repo","title":"Create the GitHub repo","status":"started"}
{"type":"message","command":"new","level":"warning","text":"agy is not on PATH; its validator is skipped"}
{"type":"result","command":"version check","ok":false,"exitCode":1,"durationMs":14,"error":{"kind":"problem","message":"2 manifests disagree with package.json","issues":[{"field":".claude-plugin/plugin.json","message":"version is 0.1.0, package.json says 0.2.0"}]}}
```

`progressLine(command, update)` and `resultLine(outcome)` build them. The last line is always the result, as in Claude Code's `stream-json`; a script that wants only the answer reads the last line.

Each line is one line for every reader. JSON escapes the control characters, and the lines also escape the characters that `JSON.stringify` leaves raw: DEL, the C1 controls (NEL among them), U+2028 and U+2029. Many readers treat NEL and the two separators as line breaks. The characters are escaped, not removed, so a reader gets the same text back.

## The command list

```ts
// packages/cli/src/commands/index.ts
export const commands: CommandList = [versionSync, versionCheck /* , one line per command */];
```

Rules, each checked by a test over the real list:

- Every path has one word or more and is unique, and no command's path is the start of another command's path.
- Every summary is one line, and every input field has a description, given before or after its optional, nullable or default wrapper.
- Every positional names a required field of the input.
- A command file loads only zod, Node built-ins (`node:`), `command-core` and `repo-model` at its top. Anything heavier (gh, npm, the TUI) loads inside `run` with `await import(...)`, so a quick command in CI stays quick. Node built-ins are allowed because they load faster than zod (measured on Bun 1.4.0 during the build: `node:path` 8 ms, `node:fs/promises` 11 ms, zod 20 ms, median of 15 starts). A type-only import loads nothing and is allowed. Known gap: an `await import(...)` at the file's top level, outside `run`, is not caught.

The list is empty until `repo-checks` adds the first real commands; this module's tests use sample commands.

## Commands

The module adds no `acmelabs` command. Its checks run in the repo's gate: `bun run check`.

## Project structure

```
packages/cli/src/command/command.ts       Command, defineCommand, Context, and the front-end's types: FrontEnd, Question, Answerer
packages/cli/src/command/world.ts         World and its options' types, and realWorld, which joins spawn and fetch
packages/cli/src/command/world-limits.ts  limits, the limits' outside failures, and the byte counter
packages/cli/src/command/world-spawn.ts   realWorld's spawn: the program runner, its process group and the group's stop
packages/cli/src/command/world-fetch.ts   realWorld's fetch: a request under its time limit and its body limit
packages/cli/src/command/fake-world.ts    fakeWorld and its scripted answers
packages/cli/src/command/outcome.ts       the failure kinds, exit codes, the throw helpers
packages/cli/src/command/input.ts         flagOf, and the checks of the input and of an answer
packages/cli/src/command/steps.ts         trackSteps: the open steps of one run
packages/cli/src/command/run.ts           runCommand
packages/cli/src/command/redact.ts        redactorFor: the secrets removed from each text that leaves runCommand
packages/cli/src/command/words.ts         sameWords: two word lists with the same words in the same order
packages/cli/src/command/lines.ts         progressLine, resultLine
packages/cli/src/command/list.ts          CommandList, the type every front-end reads
packages/cli/src/command/list-rules.ts    the command list's rules and the import scan, for the tests only
packages/cli/src/command/__tests__/       tests beside the code, at the seams the spec names. A file tested only through runCommand or realWorld has no test file of its own, such as world-limits.ts. The spawn and fetch tests call realWorld.
packages/cli/src/commands/index.ts        the command list
packages/cli/src/commands/__tests__/index.test.ts   the list's rules
```

## Code style

As in `repo-model`: `type` for shapes, functions inside a type written as properties (`spawn: (...) => ...`, as Ultracite's `method-signature-style` rule requires), function declarations with helpers above their callers, every export has a doc comment whose first line says what it is, Bun APIs, 100 columns, trailing commas. A command file reads like this:

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
12. As a maintainer, I want a bug in acmelabs to exit with its own code, so that it never looks like a problem in my repo.
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
