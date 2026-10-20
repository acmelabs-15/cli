# TUI foundations and @clack/ui

What this is: research on the foundation for a full-screen `acmelabs` TUI whose components look like Charm's Bubbles, and on the state of `@clack/ui`. Researched on 2026-10-20. Sections 1 to 4 come from a research agent of the spec session. It probed all four candidates under Bun 1.4.0, in `bun:test` and in a real PTY, in the scratchpad folder `tui-probe/`; every probe passed (`bun test`: 6 pass, 0 fail). Section 5 comes from the main session's own reads.

## 1. Bubbles and Bubble Tea: what `new` needs now

**Bubbles [1]**

| Status | Components |
|---|---|
| Needed now | textinput (name), list (kind, visibility, hosts), spinner, progress (steps), viewport (log), help, key, cursor (inside textinput) |
| Maybe | textarea (only if the description is multi-line), stopwatch (time spent waiting on CI) |
| Not now | paginator (list already paginates), table, filepicker, timer |

Bubbles has no multi-select and no confirm component [1]. Both must be built on list + key.

**Bubble Tea examples [2]**

- Needed now: isbn-form, textinput, textinputs, result, list-simple, spinner, package-manager (step progress), progress-static, progress-animated, pager, realtime, send-msg, sequence, help, fullscreen, altscreen-toggle, views, tui-daemon-combo (a TUI plus a headless mode).
- Later: chat, textarea, split-editors, tabs, table, mouse, glamour, list-default, list-fancy, paginator, timer, stopwatch, composable-views, debounce, exec, http, pipe, progress-download, spinners, simple.

## 2. Comparison

Versions and dates are from the npm registry [3]. Weekly downloads are for 2026-10-12..18 [4].

| Foundation | Version / date | Bun 1.4.0 (probe) | Components: have / build | Testability | Native deps | Risk |
|---|---|---|---|---|---|---|
| **@bomb.sh/tty** | 0.9.0, 2026-09-04; 25★, 3.2k/wk [5][4] | VERIFIED. Box renders to bytes; keys parse (`a`, ArrowUp, Ctrl+C, Backtab); PTY flow works; `bun build --compile` works | Have: layout, borders, scroll, pointer hit-test, input parser [6]. Build: every widget and focus. `@clack/ui` is named as the component layer [6] but is not on npm (registry 404). Release date UNVERIFIED | Best by design: no I/O, so bytes in and bytes out [6]. bun:test passes | None (WASM inside JS) [5] | **High.** No widgets. 39 open issues, including layout gaps (flex-shrink, wrap) [7]. A "new member of the Clack family" is announced but has no date [8] |
| **OpenTUI** (`@opentui/core`) | 0.6.6, 2026-10-14; 346 releases since 2025-08; 678k/wk [3][4] | VERIFIED. Test renderer works; PTY flow (input, then select) works; compile works (75 MB) | Have: Input, Textarea, Select, TabSelect, Slider, ScrollBox, Text, Box, Markdown, Code, Diff, TextTable [10]. Build: multi-select, confirm, spinner, progress bar, help bar | First-party `createTestRenderer` with `mockInput` and `captureCharFrame` [11]. bun:test passes | Zig library through FFI. 8 platform packages [12]; macOS arm64 is 4.3 MB. Bun ≥1.3.14; Node 26.4 only with `--experimental-ffi` [12] | **Medium.** Pre-1.0 and many releases, so the API moves (0.6.0 removed `handlePaste` [13]). Pin exact versions. OpenCode runs it in production [9] |
| **Ink** + `@inkjs/ui` | ink 8.0.0, 2026-10-03; @inkjs/ui 2.0.0, 2024-05-22; 4.8M/wk [3][15] | VERIFIED. `useInput` works with no `stdin.resume()` workaround; PTY flow (text input, then multi-select) works. Compile with `--external react-devtools-core` builds but **crashes at start**. Bundling `react-devtools-core` works | Have (@inkjs/ui, checked in the installed package): text-input, select, multi-select, confirm-input, spinner, progress-bar, status-message. Ink 8 adds `contentOffsetX/Y` for scroll views [15]. Build: viewport, help/key, table | ink-testing-library 4.0.0 (2024) works in bun:test with a fake stdin | None (Yoga is WASM) | **Medium.** Ink sends Bun bugs to Bun's tracker [17]; bun#6862 is still open [16]. Compile quirk [18]. The UI kit has had no release since 2024 |
| **@oakoliver/bubbles** (port of Bubbles) | 1.2.2, 2026-10-04; 20/wk [19][4] | VERIFIED. Pure update/view works in bun:test; PTY flow works; compile works | All 14 Bubbles, plus tree, at parity with bubbles v2.2.1 [19]. Build: multi-select, confirm | Pure `update`/`view`, so no terminal is needed | None | **High.** One maintainer, created 2026-03 [19][20] |

Other 2026 options are small, and their components were not checked (UNVERIFIED): Rezi `@rezi-ui/core` 0.1.0-beta.2 (2026-06), `@mariozechner/pi-tui` 0.73.1 (2026-05), cinnamon-bun 0.2.0 (2026-08) [3].

**Claude Code uses Ink.** The Ink README lists Claude Code under "Who's using Ink" [14]. Analyses of leaked source say it uses a heavily modified in-repo Ink fork (UNVERIFIED) [23].

## 3. Headless pattern: one command list, two front-ends

What the official docs confirm about Claude Code [21]:

- `-p` runs the same agent loop without the UI.
- Exit code 0 means success; non-zero means failure.
- `--output-format` selects structured output.
- `--bare` skips auto-discovery so CI runs are reproducible.

Internal design, from leaked-source analyses (UNVERIFIED) [22][23]:

- `main.tsx` checks whether the session is interactive.
- Interactive runs go to `launchRepl` and the Ink tree. Headless runs go to `QueryEngine`.
- Both paths share one loop (`query.ts`).
- In headless mode, permission prompts become flags or denials.

The agent's model for acmelabs:

1. Each command is a core that takes typed input and yields typed events: `step-start`, `step-done`, `log`, `needs-input`.
2. The TUI front-end renders the events and asks for any missing input.
3. The headless front-end takes all input from flags. If a required flag is missing, it exits non-zero. It prints text or JSON lines.
4. The mode comes from a flag, `!stdout.isTTY`, or `CI`.

## 4. The agent's recommendation

**OpenTUI core.** Its reasons:

- It is built for Bun.
- It has the best bun:test story: a first-party test renderer with mock keys and frame capture.
- The hard widgets (text editing, select, a scroll box for the log view) are built in.
- It works in a compiled binary, and OpenCode runs it in production.
- Five small widgets remain to build in Bubbles style: multi-select, confirm, spinner, progress, help bar. Bubbles and @oakoliver/bubbles behaviour serve as the spec.

Runner-up: **Ink + @inkjs/ui**. It is the same stack as Claude Code and covers more of `new` today. The costs: Bun is not an Ink target, the UI kit is stale, and the compile quirk above. Revisit **@bomb.sh/tty** when `@clack/ui` ships.

A by-product that works with any foundation: `Bun.spawn({ terminal })` plus `@xterm/headless` makes an end-to-end PTY test oracle (submit a value, then the next prompt must appear on the emulated screen).

Peter chose `@bomb.sh/tty` with the `@clack/ui` preview copied in, on 2026-10-20. The spec interview record holds that answer.

## 5. @clack/ui: what exists (main session, 2026-10-20)

| Fact | Detail | How found |
|---|---|---|
| npm | `@clack/ui` returns 404. | `curl https://registry.npmjs.org/@clack%2fui` |
| Preview build | `https://pkg.pr.new/bombshell-dev/ui/@clack/ui@a60ac12`: HTTP 200, a 9 KB gzip tarball (60 KB unpacked), version 0.0.0. | `curl` into the scratchpad folder `clack-ui-preview`; files listed and read only, nothing run |
| Source repo | `bombshell-dev/ui`. `gh repo view` cannot resolve it, and it is not in the org's public repo list, so it is not public. | `gh repo view`, `gh repo list bombshell-dev` |
| License | MIT, "Copyright (c) 2025-Present Bombshell contributors". | `package/LICENSE` |
| Contents | `src/components/box.ts`, `src/components/text.ts`, `src/render/createRoot.ts`, `src/render/ids.ts`, `src/children.ts`, two test files, and the built `dist/`. `index.ts` exports `rgba` (from `@bomb.sh/tty`), `box`, `text` and `createRoot`. `box` is a pass-through to the tty `open` op, with an optional `key` for identity across renders. | `package/src/` |
| Dependencies | `@bomb.sh/tty` ^0.7.0 and `@types/node` ^22.20.0. devEngines: pnpm ^10.7.0 and Node ^22.14.0. Homepage `https://bomb.sh/docs/ui`. | `package/package.json` |
| bombshell's own use | The playground repo (MIT) pins `@clack/ui` in its pnpm catalog to the same pkg.pr.new URL. It also copies the source into `vendor/ui` as the workspace package `@clack/vendored.ui`. Its input examples (`1-raw` to `7-focus`) import `box`, `text`, `createRoot` and `rgba` from `@clack/vendored.ui`, keep state in `alien-signals` signals, and use a focus index to pick the panel that receives keys. The playground's last commit is from 2026-08-16. | `gh api` on `bombshell-dev/playground` |
| Clack repo | `bombshell-dev/clack` has two packages on main, `core` and `prompts`. Branches include `builder`, `tasklog-component` and `wip-component`. | `gh api` |

What bombshell says it plans:

- The tty docs (`bombshell-dev/docs`, `src/content/docs/tty/basics/getting-started.mdx`) say `@bomb.sh/tty` is "a low-level, platform-independent terminal renderer and event parser". For one-shot prompts they point to `@clack/prompts`. For "Component-based UI with state and bindings: use `@clack/ui`, which is built on `@bomb.sh/tty` and handles the higher-level framework concerns for you."
- The Frontside partnership post (https://bomb.sh/blog/partnership-frontside/) says TTY is "the foundational infrastructure Bombshell's upcoming TUI library and framework will be built on". It says "A new member of the Clack family is coming—more on that soon", and that TTY becomes "the rendering foundation for Clack and Clink".
- No release date for `@clack/ui` was found.

## Sources

[1] https://github.com/charmbracelet/bubbles
[2] https://github.com/charmbracelet/bubbletea/tree/main/examples
[3] https://registry.npmjs.org/ (per package, e.g. https://registry.npmjs.org/@opentui%2Fcore)
[4] https://api.npmjs.org/downloads/point/last-week/ink (and per package)
[5] https://github.com/bombshell-dev/tty
[6] https://bomb.sh/docs/tty/basics/getting-started/
[7] https://github.com/bombshell-dev/tty/issues
[8] https://bomb.sh/blog/partnership-frontside/
[9] https://github.com/anomalyco/opentui
[10] https://opentui.com/docs/components/
[11] https://opentui.com/docs/core-concepts/testing/
[12] https://opentui.com/docs/getting-started/runtime-support/
[13] https://opentui.com/docs/components/input/
[14] https://github.com/vadimdemedes/ink
[15] https://github.com/vadimdemedes/ink/releases/tag/v8.0.0
[16] https://github.com/oven-sh/bun/issues/6862
[17] https://github.com/vadimdemedes/ink/issues/636
[18] https://github.com/vadimdemedes/ink/issues/886
[19] https://www.npmjs.com/package/@oakoliver/bubbles
[20] https://engineering.oakoliver.com/articles/getting-started-bubbletea-typescript-terminal-apps
[21] https://code.claude.com/docs/en/headless
[22] https://shreyan1.github.io/Learn-from-Claude-Leaked-Code/architecture.html (UNVERIFIED)
[23] https://manavgup.github.io/shipai/deep-dives/claude-code/02-architecture.html (UNVERIFIED)
