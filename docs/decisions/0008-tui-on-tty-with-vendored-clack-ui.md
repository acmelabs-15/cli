# The TUI runs on @bomb.sh/tty, with a vendored copy of the @clack/ui preview

Decided by Peter on 2026-10-20 (spec interview, QA8 and QA9).

The TUI draws with `@bomb.sh/tty`. Its component layer starts from a copy of the `@clack/ui` preview (commit `a60ac12`, MIT), kept as a local workspace package the way bombshell's own playground keeps it, with our Bubbles-style components built beside it in the same style: state in `alien-signals`, focus by index. When bombshell publishes `@clack/ui`, the copy is swapped for the npm package, and our components retire one by one as theirs ship. Peter chose this for the bombshell family: bombshell plans tty as the renderer for both its TUI layer and clack, so the TUI and CLI mode converge on one look.

## Considered options

- **OpenTUI.** The agent's recommendation: Bun-first, used by OpenCode in production, with text input, select, a scroll area and a test renderer already built. Rejected for the family fit above, at the cost of building every component ourselves.
- **Ink.** Claude Code's library. Rejected: Bun is not an Ink target, and its UI kit had no release since 2024.
- **Depending on the preview's pkg.pr.new URL.** Rejected: a published package would fetch a preview build with no stability promise.

## Consequences

- We build every component and the focus handling: text input, list, multi-select, confirm, spinner, progress, scroll area and help bar.
- The preview targets tty 0.7; a prototype checks it on tty 0.9 before the `tui-kit` spec.
