# Packages for the command runtime

What this is: research for Peter's question of 2026-10-20: "All this logic we're building around commands. Does a package like citty or the router package not provide any of this? It seems like a lot of custom stuff." The note lists which packages could replace the custom code in `packages/cli/src/command/` and the planned `packages/cli/src/github/` steps, what each one would gain and lose, and what no package covers. It decides nothing. Researched on 2026-10-20 by a research agent, with Exa, the npm registry, `gh api` reads of public source, the installed sources of each package, and probes.

In this note, the **command runtime** is the code that runs a command: its declaration, `runCommand`, the progress updates, the outcome and exit code, JSON mode's lines, the World, and the redaction. The glossary has no word for it yet (see "Gaps").

Probe machine: macOS (Darwin 25.6.0), arm64, Bun 1.4.0 (`34cbb9a40`). The latest Bun on npm is 1.4.3 (2026-10-10); no probe ran on it. Each package was installed alone with `bun add` in its own folder, so the package count comes from that folder's `bun.lock` and the size from `du -sk node_modules`. The probe scripts sit in the session scratchpad (`runtime-probe/`). They are temporary; this note keeps their results.

## Summary

**citty and the router do not provide this.** citty 0.2.2 parses arguments, routes subcommands, prints usage and runs setup and cleanup hooks; it has no schema input, no JSON mode, no exit codes per failure, no prompts and no MCP (section 1.3). `@bomb.sh/router` "is not a CLI framework. It does not own handlers, effects, output, or process lifetime" (its README, section 2). Bombshell is building "Clink", a framework that "wires flags to prompts automatically". Clink is not public on 2026-10-20: the npm name `clink` is a 167-byte placeholder (section 2).

**A built-in replaces planned code with no loss:**

- The planned `World.sleep` can wrap `setTimeout` from `node:timers/promises`, which takes a signal on Bun 1.4.0 (probe: it rejects 102 ms into a 2 s wait when the signal aborts). It rejects with an `AbortError` that holds the signal's reason in `cause`. `runCommand` reports every failure after a cancel as `cancelled`, so the outcome does not change. `fakeWorld`'s clock stays custom.

**A package replaces custom code with a named loss:**

| Custom code | Package | What it would gain | What it would lose |
|---|---|---|---|
| `realWorld`'s spawn: about 245 code lines of `world.ts` (process group, SIGTERM then SIGKILL, byte counter, time limit) | execa 10.2.0 with `killDescendants`, `forceKillAfterDelay`, `timeout`, `maxBuffer` and `encoding: "buffer"`, `cancelSignal` | It matched `realWorld` on all four probe cases (section 3.2). Windows support through `taskkill`. A maintained implementation | 18 installed packages and 1.5 MB in each install of the CLI, unless the build bundles them; a 43 ms import against zod's 20 ms; execa states no Bun support; macOS was probed, Linux was not; `maxBuffer` counts characters unless `encoding: "buffer"`; the final newline goes unless `stripFinalNewline: false`; the code that turns execa's error flags into outside failures stays ours |
| The planned body limit of `World.fetch` (task 3 of the github-ops plan) | ky 2.2.0 `maxResponseSize` | It counts body bytes after decompression; about 20 lines fewer | A `Content-Length` above the limit is read up to the limit, not refused first; ky's time limit covers the body only through its own shortcut methods, so a returned `Response` still needs `AbortSignal.timeout`; its defaults (2 retries, a throw on 4xx and 5xx, a 10 s time limit) must be turned off (section 4) |
| The command declaration, `runCommand`, the outcome, JSON mode's lines, and the planned agent guide (MCP server and skill) | incur 0.7.1 | One declaration gives zod input, `--json` and `--format jsonl`, an MCP stdio server whose progress notifications carry the command's chunks, generated skill files, `--llms`, and an exit code per error (all probed on Bun 1.4.0) | Input errors exit 1, not 2 (ADR-0007); issues name `host`, not `--host`; its JSON lines have other shapes than ADR-0007's; no prompts and no question mid-run (ADR-0007's CLI mode and TUI); no World and no fake for programs or the network; in one probe a streaming command's failure reached the MCP client as a success; it routes arguments itself, so it replaces `@bomb.sh/router` (ADR-0009); 7 more packages and about 9 MB beside zod, one of them an alpha MCP SDK (section 1) |

**No package covers:**

- `fakeWorld`: scripted command lines and requests, `missing` and `limit` answers that fail as the real World fails, and a log of every call. Only whole frameworks give a comparable seam: Effect's layers, and toolcraft's test harness for fetch, files and env (no programs).
- `steps.ts`: a step with a stable id that opens, ends as done, failed or skipped, is closed as failed on a throw, and is a bug when it starts again while open. incur's chunks, toolcraft's `progress(message: string)` and oclif's spinner are free-form.
- `redact.ts`: the secrets of the World's environment, URL credentials, secret query parameters and bearer tokens removed from every text that leaves `runCommand`.
- `lines.ts`: ADR-0007's line shapes, with DEL, the C1 controls, U+2028 and U+2029 escaped.
- `list-rules.ts`: the command list's rules and the import scan.
- `context.ask`: a question mid-run that is also a flag. trpc-cli and politty prompt for a missing input before the run, not mid-run.
- The GitHub steps. Octokit would hold a token, which ADR-0014 rejects. simple-git starts git itself through `node:child_process`, so its calls skip the World's limits and `fakeWorld`'s log.

## 1. Command runtimes

### 1.1 The packages and their state

| Package | Latest (date) | Direct dependencies | Installed packages, size | Bun | Last commit, open issues |
|---|---|---|---|---|---|
| citty | 0.2.2 (2026-04-01) | 0 | 1, 52 KB | Not stated: UNVERIFIED | 2026-08-20, 77 |
| gunshi | 0.37.3 (2026-09-16); 1.0.0-rc.1 (2026-10-02) | 0 | 1, 316 KB | Listed in its docs; verified in note 05 | 2026-10-18, 9 |
| @stricli/core | 1.3.0 (2026-07-16) | 0 | 1, 336 KB | UNVERIFIED | 2026-07-17, 31 |
| clipanion | 4.0.0-rc.4 (2024-09-06) | 1, plus peer typanion | 2, 588 KB | UNVERIFIED | 2024-09-06, 43 |
| @oclif/core | 5.1.9 (2026-10-19) | 18 | 38, 3.6 MB | `engines` asks for Node 22: UNVERIFIED | 2026-10-19, 26 |
| commander | 15.0.0 (2026-05-29) | 0 | 1, 232 KB | `engines` asks for Node 22.12: UNVERIFIED | 2026-05-29, 10 |
| cac | 7.1.0 (2026-10-11) | 0 | 1, 52 KB | `engines` asks for Node 20.19: UNVERIFIED | 2026-10-11, 30 |
| @effect/cli (Effect 3) | 0.77.2 (2026-09-15) | 3, plus 4 peers | 24, 70 MB (with `@effect/platform` and `effect` 3.22.3) | `@effect/platform-bun` exists | 2026-10-20 (Effect-TS/effect), 234 |
| effect 4, `effect/cli` | 4.0.5 (2026-10-15) | 0 | 1, 56 MB; `@effect/platform-bun` 4.0.5 adds the Bun layer | `@effect/platform-bun` 4.0.5 | as above |
| trpc-cli | 0.17.1 (2026-10-01) | 1 (commander), plus optional peers | 2, 7.4 MB (a vendored TypeBox parser, about 4 MB) | Its module mode runs ".ts modules under tsx, bun, deno"; otherwise UNVERIFIED | 2026-10-01, 18 |
| incur | 0.7.1 (2026-10-14) | 7 (zod ^4.3.6 among them) | 8, 17 MB, of which zod is 8 MB | Probed on 1.4.0: works (section 1.4) | 2026-10-15, 43 |

Sources: `https://registry.npmjs.org/<name>` (dist-tags, `time`, `dependencies`, `engines`), `gh api repos/<owner>/<repo>` and its commits, read 2026-10-20.

### 1.2 What each one covers of the list

The list is Peter's: from one command declaration, a run function with typed input from a schema; typed progress; a JSON output mode; exit codes per failure kind; prompts only on a terminal; an MCP server or tools from the same declarations; a generated agent skill or docs; a test seam with fakes for programs and the network.

| Package | Typed input from a schema | Typed progress | JSON mode | Exit code per failure kind | Prompts only on a terminal | MCP from the declarations | Skill or docs | Test seam with fakes for programs and network |
|---|---|---|---|---|---|---|---|---|
| citty | No: its own `args` types | No | No | No | No prompts | No | Usage text | No |
| gunshi | No: its own `args` | No | No | No | No prompts | No official plugin | Usage docs (`generate()`) | Partial: `cli()` returns the output |
| @stricli/core | No: parser functions | No | No | Partial: `determineExitCode(exc)` | No prompts | No | Help for all commands | Partial: an injected context, no fakes shipped |
| clipanion | Partial: typanion | No | No | Partial: `execute()` returns it | No prompts | No | Usage | Partial: `cli.run(argv, context)` |
| @oclif/core | No: its own flags | Partial: `ux.action` spinner | Yes: `enableJsonFlag` | Partial: `this.error(msg, { exit })` | No prompts in core | Community plugin only | README generator (oclif CLI) | UNVERIFIED (`@oclif/test`) |
| commander | No | No | No | Partial: `program.error(msg, { exitCode })` | No prompts | No | Help | Partial: `exitOverride()` |
| cac | No | No | No | No | No prompts | No | Help | No |
| Effect `cli` | Partial: Effect Schema, not zod | No | No | Partial: `CliError` carries a code | Partial: `withFallbackPrompt`, wizard mode | No: MCP tools are separate declarations | Help, completions | Yes: layers, in Effect style throughout |
| trpc-cli | Yes: Standard Schema | No | Partial: JSON input; output through a logger | No: one non-zero code | Yes: built-in prompts only on a TTY with no agent | No | `toJSON()` | Partial: call the router directly |
| incur | Yes: zod 4 | Partial: free-form chunks | Yes: `--json`, `--format jsonl` | Partial: `c.error({ exitCode })` | No prompts | Yes: `--mcp`, `/mcp` | Yes: `skills add`, `--llms` | Partial: `serve(argv, { env, exit, stdout })` |

### 1.3 Notes, one package at a time

**citty 0.2.2**

- "Zero dependency, fast and lightweight (based on native `util.parseArgs`)"; nested and lazy subcommands; `setup` and `cleanup` hooks; plugins with the same hooks. https://github.com/unjs/citty
- Argument types are `positional`, `string`, `boolean` and `enum`, declared in its own object form. (same README)
- The API is `defineCommand`, `runMain`, `createMain`, `runCommand`, `parseArgs`, `renderUsage`, `showUsage`, `defineCittyPlugin`. No JSON mode, exit-code table, prompt, MCP or test fake appears. (same README)

**gunshi 0.37.3 and 1.0.0-rc.1**

- Key features: universal runtime (Node, Deno, Bun), type-safe parsing "by args-tokens", lazy subcommands, pluggable renderers, i18n, plugins. https://gunshi.dev/guide/introduction/what-is-gunshi
- Official plugins: `plugin-global`, `plugin-renderer`, `plugin-i18n`, `plugin-completion`, `plugin-dryrun`, `plugin-suggestion`. None adds JSON output or MCP. https://gunshi.dev/guide/plugin/list
- A community repo builds gunshi commands and MCP tools from one zod definition. It is not on npm (registry 404 for `gunshi-mcp`). https://github.com/rektide/gunshi-mcp
- Note 05 verified gunshi on Bun 1.4.0 and its in-process test seam.

**@stricli/core 1.3.0 (Bloomberg)**

- The command's context is injected as `this`; "the context type can be customized which opens up some more options via dependency injection". https://bloomberg.github.io/stricli/docs/features/isolated-context
- Out of scope by design: cross-argument validation ("a good use case for ... `zod`"), logging, formatting, and "Prompting and `stdin`" ("`stdin` is not defined on the default context"). https://bloomberg.github.io/stricli/docs/features/out-of-scope
- `ApplicationConfiguration.determineExitCode?: (exc: unknown) => number` and an `ExitCode` table (`InvalidArgument: -4`, `UnknownCommand: -5`, `IntegrationError: -10` and others). (`@stricli/core` 1.3.0 `dist/index.d.ts`)
- `generateHelpTextForAllCommands` and an integration API with lifecycle hooks exist. (same file)

**clipanion 4.0.0-rc.4**

- The latest tag is a release candidate from 2024-09-06, and the last commit is from the same day. https://registry.npmjs.org/clipanion · https://github.com/arcanis/clipanion
- It depends on typanion for validation. (registry `dependencies`)

**@oclif/core 5.1.9 (and the `oclif` CLI 6.0.10)**

- `static enableJsonFlag: boolean`, with `jsonEnabled()`, `toSuccessJson()` and `toErrorJson()` on `Command`. (`@oclif/core` 5.1.9 `lib/command.d.ts`)
- An error takes `exit?: number`. (`lib/errors/error.d.ts`)
- `ux` exports `action` (a simple or spinner progress) and no prompt. (`lib/ux/index.d.ts`)
- 18 direct dependencies, 38 installed packages. (registry; install)
- MCP comes from a community plugin, `oclif-plugin-mcp-server` 0.7.1 (2025-07-10), which depends on `@modelcontextprotocol/sdk`, `express`, `zod` and others. https://github.com/npjonath/oclif-plugin-mcp-server · https://github.com/oclif/oclif/discussions/1796

**commander 15.0.0 and cac 7.1.0**

- commander: `program.error('Custom processing has failed', { exitCode: 2, code: 'my.custom.error' })` and `program.exitOverride()`. https://github.com/tj/commander.js
- cac: a parser with commands and help; its README shows `process.exit(1)` in user code for errors. https://github.com/cacjs/cac
- Neither has schema input, JSON mode, prompts or MCP.

**Effect: `@effect/cli` 0.77.2 (Effect 3) and `effect/cli` in effect 4.0.5**

- Effect 4 ships the CLI inside `effect` as `effect/cli` (`Command`, `Flag`, `Argument`, `Prompt`, `CliError` and others), and marks `Command` "@stability unstable". (`effect` 4.0.5 `dist/cli/Command.d.ts`)
- `Flag.withSchema` (Effect Schema) and `Flag.withFallbackPrompt` exist. (`dist/cli/Flag.d.ts`)
- Its test example builds a layer from `FileSystem.layerNoop`, `Stdio.layerTest`, a `Terminal` and a `ChildProcessSpawner`: a fake for programs. (`dist/cli/Command.d.ts`)
- `effect/process` has `ChildProcess` with `killSignal`, `forceKillAfter` ("Defaults to `undefined`, so `SIGKILL` is never sent"), `extendEnv` and `detached`; "The spawner decides whether to terminate descendants". (`dist/process/ChildProcess.d.ts`)
- `effect/ai` has `McpServer` with `layerStdio`, `layerHttp` and `toolkit`. Its tools are `Tool` declarations. No link from a CLI `Command` to an MCP tool was found in `dist/cli`. (`dist/ai/McpServer.d.ts`)
- Effect 3's `@effect/cli` offers a `--wizard` mode and built-in options. https://github.com/Effect-TS/effect/tree/main/packages/cli
- Using it means writing every command as an Effect program; zod would not feed it.

**trpc-cli 0.17.1**

- It turns a tRPC or oRPC router, or its own `t.router` ("Standalone Mode ... Experimental"), into a commander program. Inputs come from any Standard Schema validator with a JSON Schema converter: zod, arktype, valibot, effect, typebox. https://github.com/mmkal/trpc-cli
- "Built-in prompts for missing positional arguments and options are enabled by default - but only when the caller looks like an interactive human: stdin is a TTY and no coding-agent environment ... is detected." It also takes `@clack/prompts`, `@inquirer/prompts`, `enquirer` or `prompts`. (same README, "Input Prompts")
- `jsonInput: 'auto'` adds `--json <json>` for the whole input. Output goes through a logger: `yamlTableConsoleLogger` by default, or `lineByLineConsoleLogger`. (same README)
- "On error, it will log the error and exit with a non-zero exit code." No table of codes is documented. (same README, API section)
- Tests call the router through tRPC's `createCallerFactory`, or call `run()` with `process.exit` overridden. (same README, "Testing your CLI")
- No MCP: the README has no mention of it.

**incur 0.7.1 (wevm)**

- One `Cli.create()` with `.command(name, { args, options, env, output, run })` gives a CLI; `--json`; `--format toon|json|yaml|md|jsonl`; `--llms`; `--schema`; `--mcp` (stdio); an MCP endpoint at `/mcp` from `cli.fetch`; `skills add` and `mcp add`; shell completions. https://github.com/wevm/incur
- Non-TTY output defaults to TOON, "a token-efficient default format". (same README)
- `run` may be `async *run`: "Each yielded value is written as a line in human/TOON mode. With `--format jsonl`, each chunk becomes `{"type":"chunk","data":"..."}`." (same README, "Streaming")
- `c.error({ code, message, exitCode?, retryable?, cta? })`; `IncurError.exitCode`: "When set, `serve()` uses this instead of `1`." (`src/Errors.ts`, `src/Cli.ts`)
- `serve.Options` is "primarily used for testing": `env`, `exit`, `stdout`. (`src/Cli.ts`)
- The source has no prompt code: `process.stdin` appears only in `src/Mcp.ts`.
- MCP comes from `@modelcontextprotocol/server` 2.0.0-alpha.4, pinned; that package's `latest` is 2.3.1. (`incur` 0.7.1 `package.json`; https://registry.npmjs.org/@modelcontextprotocol/server)
- MCP tools use "progressive discovery by default"; `mcp: { tools: { discovery: 'direct' } }` lists each command as a tool. (same README)
- It checks for updates "in human TTY mode"; `update: false`, `CI` or `NO_UPDATE_NOTIFIER` turn that off. (same README)
- Commands take `args` (positionals) and `options` as two schemas; the repo's `Command` holds one `input` and a `positionals` list.

### 1.4 Probe: incur 0.7.1 on Bun 1.4.0

A sample CLI with `version-check` (an `async *run` that yields two step objects, then ends with `c.ok` or with `c.error({ code: "PROBLEM", exitCode: 1 })`) and `login-check` (`c.error({ code: "LOGIN", exitCode: 4 })`). stdin was `/dev/null`.

| Call | Exit | Output |
|---|---|---|
| `version-check --host claude --json` | 0 | One JSON array of the two chunks, printed at the end |
| `version-check --host claude --format jsonl` | 0 | `{"type":"chunk","data":{...}}` twice, then `{"type":"done","ok":true,"meta":{"command":"version-check","duration":"2ms"}}` |
| `version-check --host gemini --format jsonl` | 1 | Two chunk lines, then `{"type":"error","ok":false,"error":{"code":"PROBLEM","message":"2 manifests disagree"}}` |
| `version-check --host nope --json` | 1 | `{"code":"VALIDATION_ERROR", ..., "fieldErrors":[{"path":"host", ...}]}` |
| `version-check --json` (missing option) | 1 | The same error, `"missing": true` |
| `login-check --json` | 4 | `{"code":"LOGIN","message":"gh needs a login"}` |

MCP over stdio (`--mcp`, `discovery: 'direct'`), with `initialize`, `tools/list` and three `tools/call`:

- `tools/list` gave each command with its JSON Schema, the option's description included.
- A call with a `progressToken` produced two `notifications/progress`, one per yielded chunk, with the chunk as JSON text in `message`.
- `login-check` came back with `isError: true` and the message. Bad input came back with `isError: true` and "Input validation error".
- `version-check` with `host: "gemini"`, whose generator ends with `c.error`, came back with the two chunks as content and **no** `isError`. One run; UNVERIFIED whether this is a bug or a documented rule.

## 2. `@bomb.sh/router` and bombshell's plans

- The README: "An argument parser tells you what the user typed. `@bomb.sh/router` tells you where and how they intend to enter your program." It returns a typed intent: a method (`help`, `version`, `execute`) at a route, with a validated model per route. https://github.com/bombshell-dev/router
- The README: "`@bomb.sh/router` is not a CLI framework. It does not own handlers, effects, output, or process lifetime. It is not a CLI parser whose product is a bag of flags. Its product is a typed intent; your application decides what that intent does." (same README)
- It binds values from CLI arguments, environment records and JavaScript values, "CLI → environment → JavaScript values → schema default", validated by Standard Schema; `checkpoint()` and `dynamic()` pause parsing for I/O; `printErrors`, `printHelp` and `printVersion` format output for the caller to print. (same README)
- Version 0.8.0 (2026-10-09); one dependency, `@standard-schema/spec`; 29 stars; one open issue ("Move npm publication to Changesets"). https://registry.npmjs.org/@bomb.sh/router · `gh api repos/bombshell-dev/router`
- It came from Frontside's `configliere`: issue #39 is "Deprecate legacy configliere packages after first Bombshell publish" (closed 2026-10-01). https://github.com/bombshell-dev/router/issues/39
- **Clink.** On 2026-05-12 Nate Moore wrote in clack issue #533: "It's also the reason we're building Clink, which is a CLI framework that automatically handles all the various interaction modes and wires flags to prompts automatically. We hope to have a public alpha soon." https://github.com/bombshell-dev/clack/issues/533
- On 2026-05-26 a user asked whether Clink solves "questions that depened on previous answers"; the thread has no later answer. (same issue)
- The npm package `clink` 2.0.0 (2024-06-12) is 3 files, 167 bytes; its README reads "Coming Soon: Clink / The framework for CLIs". Its maintainers include natemoo-re, 43081j, dreyfus92, cowboyd and jbolda, who maintain bombshell's packages. https://registry.npmjs.org/clink
- bombshell-dev has 17 public repos on 2026-10-20 (clack, router, tty, docs, tab, args, tools, .github, automation, playground, rfd, template, clack.cc, discord-bot, manifesto, minutes, ansx). None is Clink. `gh search code --owner bombshell-dev clink` finds no Clink code. `gh api orgs/bombshell-dev/repos`
- So no bombshell package runs commands today. Whether Clink will own handlers, effects or output, and when it ships: UNVERIFIED.

## 3. Process libraries for the World's spawn

### 3.1 What each one offers

| Library | Version (date) | Time limit | Output limit per stream | SIGTERM, then SIGKILL after a delay | Stops the program's own children | Cancel signal | Adds variables to the environment | Dependencies; installed; size | Import (median of 5) |
|---|---|---|---|---|---|---|---|---|---|
| `Bun.spawn` | Bun 1.4.0 | `timeout`, to the pid only | `maxBuffer`, which overshoots: 49,140 B kept for 1,000 B (note 10) | No: one `killSignal` | No: `detached: true` makes a group; the group kill is the caller's | `signal`, to the pid only | No: `env` replaces the environment (note 10) | built in | — |
| execa | 10.2.0 (2026-10-18) | `timeout`; `error.timedOut` | `maxBuffer`, default 100,000,000, per stream; counts characters unless `encoding: "buffer"`; `error.isMaxBuffer` | `forceKillAfterDelay`, default 5,000 ms; `error.isForcefullyTerminated` | `killDescendants` (since 10.0.0, default `false`): its own process group on Unix, `taskkill` on Windows | `cancelSignal`; `error.isCanceled` | `env`, merged while `extendEnv: true` (the default) | 12; 18; 1.5 MB | 43 ms |
| execa | 9.6.1 (2025-11-29), the last 9.x | as 10.x | as 10.x | as 10.x | No `killDescendants`; `detached: true` alone did not help (probe) | as 10.x | as 10.x | 12 (`cross-spawn` among them); 23; 1.5 MB | 31 ms |
| tinyexec | 1.3.1 (2026-09-03) | `timeout`, as `AbortSignal.timeout` on Node's `spawn`, to the pid only | None; `nodeOptions.maxBuffer` was ignored (probe) | None | None; `persist: true` only sets `detached` | `signal` | Merges `process.env`, and by default puts every `node_modules/.bin` from the working folder up, and the runtime's own folder, in front of `PATH` (`nodePath: true`) | 0; 1; 36 KB | 11 ms |
| nano-spawn | 2.1.0 (2026-04-01) | Node's `timeout` option | None | None | None | `signal` | `env` merged with `process.env` | 0; 1; 72 KB | 13 ms |
| zx | 8.8.5 (2025-10-19) | `timeout`, with `timeoutSignal` | None | None | Its `kill()` lists the tree with `ps`, signals each pid, then `-pid` | `ac` or `signal` | `env` | 0 (dependencies vendored); 1; 952 KB | 43 ms |

Sources: execa `types/arguments/options.d.ts` and `lib/io/max-buffer.js` (10.2.0); https://github.com/sindresorhus/execa/blob/main/docs/api.md; the v10.0.0 release notes ("Terminate the subprocess' descendant processes ... by using the `killDescendants` option") https://github.com/sindresorhus/execa/releases/tag/v10.0.0; the v10.2.0 notes ("Exceeding `maxBuffer` now terminates the subprocess with `killSignal`, instead of leaving it running and the promise pending") https://github.com/sindresorhus/execa/releases/tag/v10.2.0; tinyexec 1.3.1 `dist/main.mjs` (`computeEnv`, `addNodeBinToPath`, `AbortSignal.timeout`); nano-spawn 2.1.0 `source/index.d.ts`; zx 8.8.5 `build/core.cjs` (`kill`, `ps.tree`, `kill(-pid)`) and `build/core.d.ts` (`Options`).

- `killDescendants` "is best-effort: descendant processes that create their own process group or session are not terminated". (execa 10.2.0 `options.d.ts`)
- execa's `cleanup` option, default `true`, kills the subprocess "when the current process exits". (same file)
- execa's README and docs folder name no Bun support (`docs/` holds api, bash, binary, debugging, environment, errors, escaping, execution, input, ipc, lines, node, output, pipe, scripts, shell, small, streams, termination, transform, typescript, windows). tinyexec, nano-spawn and zx state none either.
- The import times are each library imported alone by `bun importtime.ts <name>`, median of 5 runs. For comparison, the spec measured zod at 20 ms (`spec/SPEC-command-core.md`, the command list's rules).

### 3.2 Probe: the cases of note 10, section 2, on Bun 1.4.0

Each case ran in a fresh `bun` process. "Left 1 s later" counts the case's `sleep` programs that `pgrep` still found 1 s after the call returned. The memory column is the peak resident memory, sampled every 2 ms, minus the start. `realWorld` is the repo's own World from the working tree on 2026-10-20, with `graceMs: 500`. Ranges show two runs; other rows are one run.

**(a) A time limit of 300 ms on `bash -c "(sleep 2; echo late) & sleep 10"`.** Does the call end at the limit, or wait for the child that holds the pipe?

| Library and options | Call ended | Outcome | Left 1 s later |
|---|---|---|---|
| `realWorld`, `timeoutMs: 300` | 302–329 ms | Outside failure: `bash -c ... ran longer than 300 milliseconds and was stopped` | 0 |
| execa 10.2.0, `timeout` | 10,469–10,587 ms | `timedOut: true`; stdout `late` (4 B) | 0 (ended on their own) |
| execa 10.2.0, `timeout`, `killDescendants: true` | 309–311 ms | `timedOut: true` | 0 |
| execa 9.6.1, `timeout` | 10,482 ms | `timedOut: true` | 0 |
| execa 9.6.1, `timeout`, `detached: true` | 10,497 ms | `timedOut: true` | 0 |
| tinyexec 1.3.1, `timeout` | 10,514–10,568 ms | `AbortError` | 0 |
| nano-spawn 2.1.0, `timeout` | 10,528–10,570 ms | "Command was terminated with SIGTERM" | 0 |
| zx 8.8.5, `timeout` | 431–682 ms | `signal: SIGTERM` | 0 |

**(b) An output limit of 1 MiB on `yes`, with a 1 s time limit as a guard.** Does memory stay bounded, and how far past the limit does it read?

| Library and options | Call ended | Outcome | Memory |
|---|---|---|---|
| `realWorld`, `maxOutputBytes: 1 MiB` | 7 ms | Outside failure: `yes printed more than 1 MB on stdout and was stopped` | +4.4 MiB |
| execa 10.2.0, `maxBuffer: 1 MiB` | 45–58 ms | `isMaxBuffer: true`; 1,048,575 characters kept: the limit, less the final newline that execa strips | no growth (it fell by 52 MiB) |
| execa 9.6.1, `maxBuffer: 1 MiB` | 43 ms | as 10.2.0 | no growth |
| tinyexec 1.3.1 (no limit option) | 1,076 ms, at the time limit | `AbortError` | +1,049 MiB |
| tinyexec 1.3.1, `nodeOptions: { maxBuffer }` | 1,022 ms, at the time limit | `maxBuffer` ignored | +1,147 MiB |
| nano-spawn 2.1.0 (no limit option) | 4,513 ms; the time limit was 1 s | SIGTERM; 1,847,598,479 B of stdout kept | +1,262 MiB |
| zx 8.8.5 (no limit option) | Did not end; the 60 s guard killed it | — | `/usr/bin/time -l`: 2.1 GB maximum resident set, 15.8 GB peak memory footprint |

**(c) A program that ignores SIGTERM: `bash -c "trap '' TERM; sleep 3"`, a 300 ms time limit and a 500 ms SIGKILL delay.**

| Library and options | Call ended | Outcome | Left 1 s later |
|---|---|---|---|
| `realWorld`, `graceMs: 500` | 802 ms | Outside failure, the time limit | 0 |
| execa 10.2.0, `forceKillAfterDelay: 500` | 3,469 ms | `timedOut`, `isForcefullyTerminated`, SIGKILL: bash died at about 800 ms, and its `sleep 3` held the pipes | 0 |
| execa 10.2.0, the same and `killDescendants: true` | 810–813 ms | as above | 0 |
| execa 9.6.1, `forceKillAfterDelay: 500` | 3,480 ms | as execa 10 without `killDescendants` | 0 |
| tinyexec 1.3.1 (no SIGKILL option) | 3,517 ms | `AbortError` | 0 |
| nano-spawn 2.1.0 (no SIGKILL option) | 3,539 ms | **Resolved as a success**, exit 0: nothing tells the caller that the limit passed | 0 |
| zx 8.8.5 (no SIGKILL option) | 3,603 ms | `signal: SIGTERM` | 0 |

**(d) A cancel at 200 ms on the program of case (a), no time limit.**

| Library and options | Call ended | Outcome | Left 1 s later |
|---|---|---|---|
| `realWorld`, `signal` | 201–202 ms | The signal's reason (`AbortError`) | 0 |
| execa 10.2.0, `cancelSignal` | 10,472–10,591 ms | `isCanceled: true` | 0 |
| execa 10.2.0, `cancelSignal`, `killDescendants: true` | 203–204 ms | `isCanceled: true` | 0 |
| execa 9.6.1, `cancelSignal` (with or without `detached`) | 10,480–10,513 ms | `isCanceled: true` | 0 |
| tinyexec 1.3.1, `signal` | 10,518–10,574 ms | "was killed by the signal SIGTERM": a cancel looks like any outside SIGTERM | 0 |
| nano-spawn 2.1.0, `signal` | 201–203 ms | `isCanceled: true` | **2**: `sleep 2` and `sleep 10` still ran |
| zx 8.8.5, `ac.abort()` | 203 ms | "The operation was aborted" | **2**: `sleep 2` and `sleep 10` still ran |

More probes of execa 10.2.0 on Bun 1.4.0:

- A missing program rejects with `code: "ENOENT"` and "Command failed with ENOENT: no-such-program-xyz / Executable not found in $PATH".
- 600 `é` (1,200 bytes) with `maxBuffer: 1000` and the default encoding: no limit reached; 600 characters kept. With `encoding: "buffer"`: `isMaxBuffer: true`, 1,000 bytes kept.
- `printf 'a\n\n'` gives `"a\n"`: the final newline goes by default (`stripFinalNewline: true`).
- `env: { A_VAR: "added" }` reached the program beside `HOME`.
- After a stop at a 300 ms time limit with `killDescendants` and the default 5,000 ms SIGKILL delay, the `bun` process exited 761 ms after it started (the call ended at 326 ms). With `realWorld` the same run exited after 353 ms (the call ended at 303 ms). Neither waited for the delay.

## 4. Requests: a time limit to the end of the body and a byte limit

Bun's `fetch` with `AbortSignal.timeout(ms)` already stops a slow body at the limit (note 10, section 3: 1,201 ms for a 1,200 ms limit). The probe below ran ky and ofetch against a local `Bun.serve` server on Bun 1.4.0. "Slow body" sends headers, then 1 byte every 500 ms, 21 bytes in all.

| Call | Ended | Result |
|---|---|---|
| ky 2.2.0, `timeout: 1200`, `.text()` on ky's promise | 1,731 ms | `TimeoutError`: the wait for headers and the body read each get the limit |
| ky, `timeout: 1200`, `await ky(...)`, then `response.text()` | 10,523 ms | The whole body: a returned `Response` has no time limit |
| ky, `totalTimeout: 1200`, `timeout: false`, `.text()` on ky's promise | 1,203 ms | `TimeoutError` |
| ky, `totalTimeout: 1200`, `await ky(...)`, then `response.text()` | 10,541 ms | The whole body |
| ky, slow headers (3 s), `timeout: 300` | 304 ms | `TimeoutError` |
| ky, `maxResponseSize: 1 MiB`, an endless chunked body | 6 ms | `ResponseSizeError` |
| ky, `maxResponseSize: 1 MiB`, a 50 MiB body with `Content-Length` | 33 ms (shortcut), 19 ms (returned `Response`) | `ResponseSizeError` after reading up to the limit |
| ky, a cancel at 200 ms, `timeout: 2000` | 201 ms | `AbortError`: a cancel stays a cancel |
| ky with its defaults, a 500 answer | 917 ms | `HTTPError` after 3 calls to `fetch` (2 retries) |
| ky, `fetch` option set to a counting wrapper | 2 ms | The wrapper got the call: ky can sit on top of `World.fetch` |
| ofetch 1.5.1, `timeout: 1200`, slow body | 4,001–4,002 ms | `TimeoutError` "The operation timed out.": not at the limit; the cause is UNVERIFIED |
| ofetch, no `timeout`, slow body | 10,542 ms | The whole body |
| ofetch, `timeout: 300` and its own `signal`, slow headers | 3,004 ms | Success: the time limit was ignored |
| ofetch, `timeout: 300`, no signal, slow headers | 303 ms | `FetchError` with "[TimeoutError]" |
| Bun `fetch`, a signal that never aborts, slow body (control) | 10,525 ms | The whole body |

- ky's `timeout` is a "Per-attempt timeout ... for getting a response"; "Ky shortcut methods also use this value as a separate timeout for reading the response body". Default 10,000 ms. https://github.com/sindresorhus/ky#timeout
- ky's `maxResponseSize` "counts bytes from the response stream after decompression, independently of `Content-Length`. ... With `await ky(url)`, the response can resolve before the limit is exceeded; the body read will reject instead." Default `Infinity`. https://github.com/sindresorhus/ky#maxresponsesize
- ky "targets modern browsers, Node.js, Bun, and Deno". ky 2.2.0 (2026-10-09) has 0 dependencies, 1 package, 840 KB installed. (README; registry; install)
- ofetch 1.5.1 sets its time limit only `if (!context.options.signal && context.options.timeout)`, and clears the timer in a `finally` right after `fetch` resolves, before the body is read. It has no byte limit. (`ofetch` 1.5.1 `dist/shared/ofetch.CWycOUEr.mjs`, lines 261–290) https://github.com/unjs/ofetch
- ofetch 1.5.1 (2025-11-01) has 3 dependencies, 4 packages, 1.1 MB installed; a 2.0.0-alpha.3 exists (2025-10-28), not examined.
- So no small wrapper gives both limits on a returned `Response`. ky gives the byte limit on one; its time limit to the end of the body needs ky's shortcut methods, or the `AbortSignal.timeout` that the World plans anyway.

## 5. File by file: what a package could replace

The requirements cited: ADR-0007 (one command list for every front-end; prompts only in a terminal; a missing input names its flag; JSON mode's progress lines and the result last; exit codes 0, 1, 2, 3, 4, 130 and 70), ADR-0009 (routing by `@bomb.sh/router`), ADR-0013 (dependency trees kept out of every repo), ADR-0014 (gh api and git with gh's login; no token held), ADR-0015 (the whole environment; time and output limits; the process group), and `spec/SPEC-command-core.md` (commands reach the outside world only through the World; quick commands load only zod, `node:` built-ins and command-core at their top). Code lines exclude comments and blank lines, counted on 2026-10-20.

| File (code lines) | What it does | Package that could replace it | Gain | Loss |
|---|---|---|---|---|
| `command.ts` (46) | `Command`, `defineCommand`, `Context`, `ProgressUpdate`, `Question`, `FrontEnd` | incur's `Cli.command`; trpc-cli's procedure; politty's `defineCommand` | Fewer types of our own | Each package's context lacks the World and `ask`; incur and politty split positionals into their own schema; the TUI reads none of them (ADR-0007) |
| `run.ts` (174) | `runCommand`: checks input, builds the context, `ask`, cancel → 130, any other throw → 70, redaction, result must be JSON | incur's `serve` (partly) | Routing, help, JSON mode and MCP from one place | Input errors exit 1 (probe); no 130 or 70 kinds found (Ctrl+C handling UNVERIFIED); no `ask`; no redaction; replaces the router (ADR-0009) |
| `outcome.ts` (47) | Failure kinds, exit codes, throw helpers | incur's `c.error({ exitCode })`; stricli's `determineExitCode`; commander's `program.error`; oclif's `this.error` | — (each still needs our table of kinds) | The table of kinds stays ours in every case |
| `input.ts` (77) | Flag names (`--dry-run`), zod issues named by flag or `<positional>`, the answer check, the "no value" error | incur, trpc-cli and politty check zod input themselves | — | incur's issue reads `path: "host"`, not `--host` (probe); ADR-0007 asks that the error name the flag |
| `steps.ts` (54) | The open steps of one run: started, done, failed or skipped; closed as failed on a throw; a restart is a bug | None found | — | — |
| `lines.ts` (32) | `progressLine`, `resultLine`, escaping DEL, C1, U+2028, U+2029 | incur's `--format jsonl` | One flag | Other shapes (`{"type":"chunk","data":...}`, `{"type":"done",...}`, `{"type":"error",...}`); `--json` prints one array at the end, not live lines (probe); its escaping of NEL and U+2028: UNVERIFIED |
| `redact.ts` (25) | Removes env secrets, URL credentials, secret query values and bearer tokens from each text that leaves | None found in the frameworks read; toolcraft redacts declared secrets in its error reports and auth headers in `--verbose`; incur shows only the last 4 characters of an env value in help | — | — |
| `list.ts` (4), `list-rules.ts` (89) | The command list's type, its rules and the import scan | None found; incur's `.fs()` and gunshi's `lazy()` load commands from files | — | — |
| `words.ts` (3) | `sameWords` | Not worth a package | — | — |
| `world.ts`: `realWorld` (244) | `spawn` with a process group, SIGTERM then SIGKILL, time and output limits, the whole environment plus `env`, ENOENT as an outside failure | execa 10.2.0 with `killDescendants` | Section 3: the same four results; Windows; less code of ours | 18 installed packages and 1.5 MB unless bundled; 43 ms import (it can load inside `spawn` with `await import`); no Bun claim; Linux unprobed; `encoding: "buffer"` and `stripFinalNewline: false` needed to keep output byte for byte; its error flags still map to our outside failures |
| `world.ts`: `fakeWorld` (103) | Scripted spawn and fetch, `missing` and `limit` answers, the call log | None found outside whole frameworks (Effect layers; toolcraft's harness has fetch, files and env but no programs) | — | — |
| `world.ts`: the planned fetch limits (task 3) | `AbortSignal.timeout` to the end of the body; `Content-Length` refused early; a counting reader | ky 2.2.0 for the counting reader | About 20 lines | No early refusal by `Content-Length`; the time limit stays ours; ky's retry, throw and time-limit defaults must be off |
| `world.ts`: the planned `sleep` (task 4) | Waits unless the signal aborts; the fake moves its clock | `node:timers/promises` `setTimeout` (built in) | A few lines | None for the outcome; the fake clock stays ours |
| `github/gh.ts` (planned) | One REST call through `gh api` | Octokit (`@octokit/rest` 22.0.1: 4 direct dependencies, 20 installed, 18 MB) | Typed endpoints | Holds a token, which ADR-0014 rejects; its calls bypass the World |
| `github/git.ts`, `push.ts` (planned) | git command lines with gh's credential helper | simple-git 4.0.2 (5 direct dependencies, 7 installed, 2 MB) | A typed git API | It imports `spawn` from `node:child_process` and takes no spawn function (its `spawnOptions` holds only `uid` and `gid`), so its calls skip the World's limits and `fakeWorld`'s log |
| `github/repo.ts`, `settings.ts`, `login.ts`, `pull-request.ts`, `runs.ts`, `names.ts` (planned) | Read-before-write steps on GitHub | None: the logic is ACMElabs' own | — | — |

Planned modules outside these folders that a package could cover:

| Module | Package | Note |
|---|---|---|
| `agent-guide`: the MCP server and the skill from the command list | incur (built in); goke with `@goke/mcp`; politty (skills only); toolcraft | Each needs its own command declaration, so the command list would move into that package's form |
| `cli-frontend`: prompts for missing inputs, only on a terminal | trpc-cli's built-in prompts; politty with clack | Both prompt before the run, not mid-run |

### 5.1 Facts that bear on every option

- Each ACMElabs repo pins `@acmelabs/cli` as an exact devDependency (ADR-0004), so the CLI's runtime dependencies install in every repo, unless the build bundles them.
- `@acmelabs/cli` publishes JavaScript built with `bun build` (ADR-0005). Whether that build bundles its runtime dependencies is open: `spec/README.md` open question 12 bundles the vendored `@clack/ui` and leaves the rest to `cli-release`. ADR-0013 bundled Ultracite to keep 17 dependencies out of every repo.
- A command file may load only zod, `node:` built-ins and command-core at its top (`spec/SPEC-command-core.md`); `world.ts` is command-core. A library that `world.ts` imports at its top loads in every command.
- incur, politty and trpc-cli each route arguments themselves; adopting one replaces `@bomb.sh/router`, which ADR-0009 chose.

## 6. Other packages that build a CLI and an MCP server, or a skill, from one declaration

Found by searching for "CLI and MCP from one definition" and "agent-ready CLI framework". Read from the npm registry and each README on 2026-10-20; none was probed.

| Package | Version (date); first published | Direct dependencies | Input | What it builds |
|---|---|---|---|---|
| goke + `@goke/mcp` | 6.17.0 (2026-09-16), since 2020; `@goke/mcp` 0.1.2 (2026-09-16) | goke 0; `@goke/mcp` 2 (`@modelcontextprotocol/sdk`, `js-yaml`) | Standard Schema per option | CLI; MCP server from the CLI (`createMcpAction({ cli })`); injected `{ fs, console, process }` for tests; agent detection; exit codes by hand. https://github.com/remorses/goke |
| politty | 0.16.0 (2026-10-20); since 2026-01-28 | 1, peers zod, `@clack/prompts`, `@inquirer/prompts` | zod 4 | CLI; prompts for missing arguments through clack or inquirer adapters; `--help-json`; skill install; `runMain` exits 2 for an invalid command line and 1 for other failures; no MCP in the README; 6 stars. https://github.com/toiroakr/politty |
| toolcraft | 0.0.892 (2026-10-13); since 2026-04-23; 886 versions | 29 | Its own `toolcraft-schema` | CLI, MCP and an in-process SDK; handler context with `fetch`, `fs`, `env` and `progress(message: string)`; a test harness with fake fetch, files and env; `UserError` exits 1; Node 18.18 or later. https://github.com/poe-platform/poe-code |
| @bunli/core (and the `bunli` toolchain) | 0.9.1 (2026-04-09); since 2025-06-17 | 9 (`bunli`: 7) | Standard Schema options | "The minimal, type-safe CLI framework for Bun", with testing utilities (`@bunli/test`) and a TUI package; no MCP in either README. https://github.com/AryaLabsHQ/bunli |
| fireargs | 0.5.0 (2026-10-20); since 2026-03-17 | 1, peers zod and commander | zod | A commander program with `--json` input and output and an `--llms` manifest "MCP-shaped". https://fireargs.dev/ |
| @runa-cmd/core + @runa-cmd/mcp | 0.1.0 (2026-04-14); 2 versions | 0; mcp: `@modelcontextprotocol/sdk` | zod peer | CLI and `--mcp`. https://github.com/jrodrigopuca/runa-cmd |
| @clfly/core | 0.2.0 (2026-08-04); since 2026-07-22 | 4 (`@modelcontextprotocol/sdk`, `tsx`, `yargs-parser` among them) | Standard Schema | File-based routing to a CLI, completions and an MCP server. https://github.com/borkxs/clfly |
| @mcphero/core | 1.3.0 (2026-04-07) | 3 | zod | Actions as MCP tools, REST and a clack CLI. https://github.com/atomicbi/mcphero |
| @jlceda/mcli | 0.2.0 (2026-08-18); "Preview Release" | 1 (ajv, bundled) | JSON Schema | One command tree as a shell CLI and MCP meta-tools. https://github.com/easyeda/jlc-mcli |
| @moikapy/kapy | 0.4.2 (2026-05-24) | 2 | zod | `--json`, `--no-input`, a fixed exit-code table. https://moikapy.dev/kapy |
| agenttk | 0.1.6 (2026-04-24) | 1 (zod) | zod | Result envelopes, JSON output, test helpers. https://github.com/fraction12/agenttk |

## Gaps

| Open point | The probe or source that would settle it |
|---|---|
| execa's `killDescendants`, `forceKillAfterDelay` and `maxBuffer` on Linux (the CI runners); every probe here ran on macOS | Run `runtime-probe/probe.ts` (cases a to d, execa with and without `killDescendants`) in an `ubuntu-latest` job |
| Whether execa hits the macOS case that commit `586c53b` fixed in `realWorld` (signal 0 to the group answers EPERM once only ended programs remain) | Stop a group whose programs have all ended, with execa's `killDescendants` and a long `forceKillAfterDelay`; time the process exit |
| Whether execa's `cleanup` (via `signal-exit`) and `killDescendants` stop the group on Ctrl+C under Bun | Run a detached program through execa in a pseudo-terminal, send `\x03`, list the group with `ps` |
| Why a streaming incur command's `c.error` reached the MCP client without `isError` (one run) | Repeat with a non-`direct` discovery mode and a plain `run`; read `src/Mcp.ts`; ask upstream |
| Whether incur middleware can map a validation error to exit 2 and name the issue by its flag | A middleware that catches `VALIDATION_ERROR` and rethrows `IncurError({ exitCode: 2 })`; check the output |
| Whether incur's JSONL lines escape NEL, U+2028 and U+2029 | A command that yields a string holding each character; read the raw bytes |
| How incur and trpc-cli end on Ctrl+C (exit 130 or not) | Run each in a pseudo-terminal, send `\x03`, read the exit code |
| Which exit codes trpc-cli 0.17.1 uses for bad input and for a thrown error | A sample router; run bad input and a throw; read `$?` |
| ofetch's `TimeoutError` at about 4 s on a slow body with `timeout: 1200` | Read ofetch 1.5.1's `node-fetch-native` path under Bun; repeat with `Bun.serve`'s `idleTimeout` raised |
| citty, gunshi 1.0.0-rc.1, stricli, clipanion, @oclif/core, commander and cac on Bun 1.4.0 (only gunshi was probed, in note 05) | A one-command hello CLI for each, run with `bun` |
| `@oclif/test` and the `oclif readme` generator: versions and Bun behaviour | Install both; run against a sample oclif CLI |
| Effect `Flag.withFallbackPrompt`: does it prompt only on a terminal? | A sample `effect/cli` command run with stdin from `/dev/null` |
| Clink's scope (handlers, effects, output?) and release date | Watch the npm name `clink` and the bombshell-dev org; ask in bombshell's Discord (https://bomb.sh/chat) |
| A small npm package that wraps `gh api` as a library | An npm search for `gh api` wrappers; none was searched in depth here |
| Whether `@acmelabs/cli` bundles its runtime dependencies | The `cli-release` spec; `spec/README.md` open question 12 |
| Glossary: `CONTEXT.md` has no entry for command runtime, outside program, time limit or output limit | Raise them through the domain-modeling skill |
| This note has no row in `docs/research/README.md` yet: the research agent changed no other file | Add the row: "Which packages could replace the command runtime's custom code, and what stays custom?", 2026-10-20 |
