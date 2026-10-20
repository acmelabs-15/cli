# Command frameworks and prompt libraries

What this is: research on the command framework and the prompt library for `acmelabs`, and a probe of `@bomb.sh/router` on Bun. Researched on 2026-10-20. Sections 1 to 7 come from a research agent of the spec session, which ran probes on local Bun 1.4.0 in the session scratchpad (`verify/`, test file `__tests__/probe.test.ts`). Section 8 comes from the main session's own reads and its router probe.

## 1. bombshell-dev/tty

| Item | Finding |
|---|---|
| What it is | A low-level terminal renderer and input parser. It uses the Clay layout engine compiled to WASM and does no I/O itself: you feed it bytes and get bytes back. It is a foundation for a framework, not a framework. [1] |
| Release | `@bomb.sh/tty` 0.9.0, 2026-09-04. First release 0.7.0, 2026-06-18. 0 deps. [2] |
| Activity | Last commit 2026-10-19. 47 open issues and PRs. [3] |
| API | `createTerm().render(ops,{pointer})` → `{output, events}`. `createInput().scan(bytes)` → key, mouse and resize events. `alternateBuffer()` / `ALTSCREEN()` for the alternate screen. [1][2] |
| Prompt widgets | None. There is no text input, multiselect or confirm. [2] |
| Bun | The README claims Bun support. Not run in this research: UNVERIFIED. (The TUI research in note 06 later verified it.) [1] |

## 2. clack

| Item | Finding |
|---|---|
| Versions | `@clack/prompts` 1.8.1 and `@clack/core` 1.5.1, both 2026-09-13. Last commit 2026-10-15. [4] |
| Prompts | text, password, confirm, select, multiselect, groupMultiselect, autocomplete, path, date, multiline, spinner, progress, tasks, taskLog, log, stream, group, intro/outro. [5] |
| Cancel | `isCancel(v)` + `cancel()`; `group(..., {onCancel})`; a `signal: AbortSignal` option (from the 1.8.1 `.d.ts` [6]). [5] |
| Injected streams | Every prompt takes `input?: Readable` and `output?: Writable` (`CommonOptions` in the 1.8.1 types) [6]. Clack's own tests drive prompts by sending keypress events on a mock stream [7]. **VERIFIED** on Bun 1.4.0 in `bun:test`: multiselect, confirm, text and Ctrl+C cancel all pass with injected streams. |
| CI / no terminal | `isCI()` is `CI==="true"`. Only spinner and taskLog switch to static output in CI [9]. Prompts do not detect a missing terminal. The maintainer says callers must "support flags for all possible inputs, bypass prompt rendering in non-tty environments" [8]. **VERIFIED:** `text()` hung until killed, both with stdin `</dev/null` and with an open pipe. |
| Bun | The old Bun bugs with several prompts in a row (#6052, #7033) closed 2026-07-24/25. Bun's bot verified the fix on a 1.4.0 debug build. [10] |

## 3. Other bombshell-dev packages

| Package | Version (date) | What it does |
|---|---|---|
| `@bomb.sh/args` | 0.3.1 (2025-02-24) | Flag parser only. `parse(argv,{boolean,string,alias,default})` → `{_:[…]}`. No subcommands, no help. 0 deps. [11] |
| `@bomb.sh/tab` | 0.0.22 (2026-08-04) | Shell completions for zsh, bash, fish and PowerShell. Adapters for cac, citty and commander. `@gunshi/plugin-completion` 0.37.3 depends on it. [12] |
| `@bomb.sh/router` | 0.8.0 (2026-10-09) | A typed router for nested routes with help and version handling, validated by Standard Schema. It "is not a CLI framework… does not own handlers, effects, output". It needs a schema library such as zod. [13] |
| "Clink" | not public | A framework that would wire flags to prompts, announced in [8]. No package found: UNVERIFIED. |

## 4. gunshi

| Item | Finding |
|---|---|
| Versions | 0.37.3 is `latest` (2026-09-16). 1.0.0-rc.1 is tagged `rc` (2026-10-02). The 1.0 betas have breaking changes: a plugin that fails to install stops the run, command routing after option values changed, and args-tokens moved to 1.0. Last commit 2026-10-18. [14] |
| Subcommands | `define()` per command, `cli(argv, entry, {subCommands})`. Any command can have nested `subCommands`. `ctx.commandPath` gives the path. [15] |
| Lazy loading | `lazy(loader, meta)`: help reads `meta` and does not load the command. [16] |
| Help | Built in: `--help` and `--version`, plus a COMMANDS section at every level. **VERIFIED:** `--help` listed release, validate and version; `version --help` listed sync and check. [15] |
| Plugins | `plugin({id, setup(ctx){addGlobalOption, addCommand, decorateCommand}})`. [17] |
| Tests | `cli()` returns the string the command returns (or the usage text). `usageSilent` silences `ctx.log`. `generate()` returns the usage text. `createCommandContext()` builds a context for unit tests. Errors are rethrown; no `process.exit` was found in the library. **VERIFIED** in `bun:test`. [18] |
| Bun | The README lists Bun. The E2E CI job installs Bun 1.4 [19]. **VERIFIED** locally. |
| Footprint | 0 runtime deps, 248 KB. [14] |
| Problem found | In 0.37.3, a positional argument named `version` collides with the global `--version`: `release notes 1.2.3` printed "0.0.0". The same test passes on 1.0.0-rc.1. |

## 5. Bun built-ins

- `Bun.argv` includes the bun binary path and the script path. [20]
- Bun lists `node:util` as fully implemented, so `parseArgs` is available. [20]
- `parseArgs` supports only `boolean`/`string` types, plus `multiple`, `short`, `default`, `strict`, `allowPositionals`, `allowNegative` and `tokens`. [21]
- It has no subcommand routing, no nested commands, no help output and no number type. The command list and the help printer would be ours to build.

## 6. TUI or CLI

- **TUI:** owns the whole screen (alternate screen buffer), redraws continuously, and the user moves through a layout with keys or the mouse until they quit. `@bomb.sh/tty` targets this. [1]
- **CLI:** one command runs, reads flags, prints output line by line, and exits. Inline prompts render below the cursor and leave a scrollback record. Clack targets this.
- **The agent's verdict: `acmelabs` is a CLI.** Five of the six commands run in CI with no input. `new` asks a few questions in a row. Guidance: prompt only when stdin is a terminal, and always offer flags as well. [22]

## 7. The agent's recommendation

**gunshi for commands + `@clack/prompts` for prompts. Do not use tty.**

- **The design rule fits gunshi.** Each command is one file exporting `define()`/`lazy()`, registered with one `subCommands` line. Nested commands (`version sync`) and `--help` come from gunshi.
- **Tests run in-process** with argv passed in and the output returned (verified).
- **The two combine cleanly.** gunshi does not touch stdin. Clack runs only inside the `run()` of `new` (and the confirm in `marketplace add`). `lazy()` keeps clack out of the CI commands' load path.
- **Required guard:** check `isTTY` / `--no-input` before any prompt. Every prompt needs a flag equivalent (`--description`, `--host`, `--yes`). Otherwise a prompt hangs in CI (verified).
- **Footprint:** 7 packages installed in total (gunshi plus 6 for clack), verified with `bun add`.

Alternatives it named:

- `@bomb.sh/router` + clack: same organization and typed, but 0.x, needs a schema library, and the dispatch code is ours.
- `parseArgs` + clack: no dependencies for arguments, but routing and help are ours.

It left one choice open: pin gunshi 0.37.3 (stable; a positional named `version` breaks, so name it `semver`) or 1.0.0-rc.1 (fixes that, but is a release candidate with breaking changes).

Peter later chose a TUI by default, then `@bomb.sh/router` and `@bomb.sh/args` in place of gunshi. The spec interview record holds those answers.

## 8. @bomb.sh/router: reads and a probe on Bun 1.4.0

Produced by the main session on 2026-10-20.

### Reads

- The repo `bombshell-dev/router` is Deno-first. Its root has `deno.json` (name `@bomb.sh/router`, exports `./mod.ts`, MIT) and no `package.json`. It builds the npm package with `@deno/dnt` (`tasks/build-npm.ts`). Its dev imports include `zod` ^4.4.3, `arktype` ^2.2.3 and `@standard-schema/spec` ^1.1.0.
- It has its own tokenizer (`lib/tokenize.ts`, `lib/tokenizer.ts`). It does not depend on `@bomb.sh/args`.
- `mod.ts` exports `argument` (positional values), `command`, `route`, `option`, `toggle`, `multiple`, `param`, `schema`, `name`, `description`, `version`, `executable`, `extend`, `checkpoint`, `dynamic`, `env`, `withEnvs`, `withValues`, `transform`, `mark`, `cli`, `parse`, `printErrors`, `printHelp` and `printVersion`.
- The README says: "Command literals are routing tokens, not positional arguments." Parameters bind to the segment that owns each token. It binds values from CLI arguments, environment records and JavaScript values, in the order CLI → environment → JavaScript values → schema default. Zod, ArkType, Valibot and other Standard Schema libraries work without adapters.
- `@bomb.sh/args` is version 0.3.1 with no dependencies.

### Probe

Installed in the scratchpad folder `router-probe`: `@bomb.sh/router@0.8.0`, `zod@4` (4.6.7) and `@bomb.sh/args@0.3.1`. Bun reported 1.4.0. The probe defined this tree:

```ts
command(name("acmelabs"), description(...), version("0.0.0"),
  toggle(name("json")),
  command(name("new"), argument(name("name"), schema(z.string())),
    option(name("description"), schema(z.string().optional())),
    option(name("host"), schema(z.string().optional()))),
  route(name("version"), command(name("sync")), command(name("check"))),
  route(name("release"), command(name("notes"), argument(name("version"), schema(z.string())))),
  command(name("validate")),
  route(name("marketplace"), command(name("add"))),
  command(name("upgrade")),
  command(name("mcp")),
)
```

| Input | Observed result |
|---|---|
| `acmelabs --help` | HELP `/`. Lists every command: new, version, release, validate, marketplace, upgrade, mcp. Options: `--json, --no-json`, `-h, --help`, `-v, --version`. |
| `acmelabs version --help` | HELP `/version`. Lists sync and check. |
| `acmelabs release notes 1.2.3` | EXECUTE `/release/notes` with `{"version":"1.2.3"}`. The positional named `version` does not clash with `--version`. |
| `acmelabs release notes 1.2.3 --json` | Error: ``unexpected: `--json` ``. The root's `--json` binds only at the root segment. |
| `acmelabs --json version sync` | EXECUTE `/version/sync`, root model `{"json":true}`. |
| `acmelabs new my-plugin --description A plugin` | EXECUTE `/new` with `{"name":"my-plugin","description":"A plugin"}`. |
| `acmelabs new` | Error: `name: Invalid input: expected string, received undefined`. |
| `acmelabs version` | Error: `version does not support EXECUTE`, available method HELP. |
| `acmelabs --version` | VERSION. |
| `acmelabs` (no arguments) | EXECUTE `/` with `{"json":false}`. |

## Sources

[1] https://github.com/bombshell-dev/tty
[2] https://registry.npmjs.org/@bomb.sh/tty
[3] https://api.github.com/repos/bombshell-dev/tty
[4] https://registry.npmjs.org/@clack/prompts, https://registry.npmjs.org/@clack/core
[5] https://github.com/bombshell-dev/clack/blob/main/packages/prompts/README.md
[6] https://github.com/bombshell-dev/clack/releases/tag/%40clack%2Fprompts%401.0.0-alpha.0
[7] https://github.com/bombshell-dev/clack/blob/main/packages/prompts/test/test-utils.ts
[8] https://github.com/bombshell-dev/clack/issues/533
[9] https://github.com/bombshell-dev/clack/commit/f9f139debce559ca91f6b18f2ed741f59f4b2c48
[10] https://github.com/oven-sh/bun/issues/7033, https://github.com/oven-sh/bun/issues/6052
[11] https://github.com/bombshell-dev/args, https://registry.npmjs.org/@bomb.sh/args
[12] https://github.com/bombshell-dev/tab, https://registry.npmjs.org/@gunshi/plugin-completion
[13] https://github.com/bombshell-dev/router, https://registry.npmjs.org/@bomb.sh/router
[14] https://registry.npmjs.org/gunshi, https://github.com/kazupon/gunshi/releases
[15] https://gunshi.dev/guide/advanced/nested-sub-commands
[16] https://gunshi.dev/guide/essentials/lazy-async
[17] https://gunshi.dev/guide/plugin/lifecycle
[18] https://gunshi.dev/api/default/interfaces/CliOptions, https://gunshi.dev/guide/advanced/docs-gen
[19] https://github.com/kazupon/gunshi/blob/main/.github/workflows/ci.yml
[20] https://bun.com/guides/process/argv, https://bun.com/docs/runtime/nodejs-compat
[21] https://nodejs.org/api/util.html#utilparseargsconfig
[22] https://clig.dev/#interactivity
