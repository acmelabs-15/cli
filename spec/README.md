# ACMElabs CLI: capability map

The index of the spec. Peter approved this map on 2026-10-20 (`docs/design/spec-interview.md`, QM). Each module gets its own spec, `spec/SPEC-<module-id>.md`, written in build order, then planned, built and tested before the next layer starts. Module ids are fixed; specs, plans and tasks select work by them. Words follow `CONTEXT.md`. The reasons behind the choices are in `docs/decisions/`.

## Modules

| Layer | Module id | Responsibility | Depends on | Spec |
|---|---|---|---|---|
| 1 | `repo-model` | The repo config (repo kind, hosts) and the host table: each host's manifests, version fields and validator | none | not written |
| 1 | `command-core` | The command list: each command's inputs, events, result, errors and exit codes | none | not written |
| 1 | `tui-kit` | The theme, the vendored `@clack/ui` preview, and the Bubbles-style components with focus | none | not written; prototype first |
| 1 | `config-presets` | `@acmelabs/config`: the oxlint, oxfmt and tsconfig presets, each deviation with its reason | none | not written |
| 1 | `github-ops` | GitHub steps: create a repo, set visibility, the Actions setting and the "Protect main" ruleset, push, open a PR, watch a run | none | not written |
| 1 | `npm-ops` | npm steps: registry reads, web login, org creation, the placeholder version, the trusted publisher | none | not written |
| 2 | `cli-frontend` | Direct calls: routing with `@bomb.sh/router`, help, CLI mode with themed clack prompts, JSON mode | `command-core`, `tui-kit` | not written |
| 2 | `repo-checks` | `version sync`, `version check`, `release notes`, `validate` | `repo-model`, `command-core` | not written |
| 3 | `shared-workflows` | acmelabs-15/.github: the CI and release workflows (plugin and library paths), their own tests, the `v1` line | `repo-checks` | not written |
| 4 | `cli-release` | This repo's own CI and releases on the shared workflows; the first publishes of both packages; their trusted publishers | `shared-workflows`, `config-presets`, `cli-frontend`, `npm-ops` | not written |
| 4 | `jev-gate-migration` | jev-gate onto the shared pieces, with no change in what it does | `shared-workflows`, `config-presets`, `cli-release` | not written |
| 5 | `marketplace-add` | `marketplace add`, and the marketplace README's "Add a plugin" section | `repo-model`, `command-core`, `github-ops` | not written |
| 5 | `upgrade` | `upgrade`: the running copy to the latest published version | `command-core`, `npm-ops` | not written |
| 5 | `tui-app` | The TUI's screens: the command menu, input forms, the run view | `command-core`, `tui-kit` | not written |
| 5 | `agent-guide` | The generated skill, `acmelabs mcp`, and this repo's plugin manifests for the four hosts | `command-core`, `repo-model` | not written |
| 6 | `scaffold` | `acmelabs new`: plugin repos and library repos, end to end | `repo-model`, `command-core`, `github-ops`, `npm-ops`, `marketplace-add`, `shared-workflows`, `config-presets` | not written |

Build order: layer 1, then 2, 3, 4, 5, 6. Modules in one layer can be built in parallel. jev-gate moves in layer 4 on purpose: it proves the CLI release, the shared workflows and the presets on a real repo before `scaffold` builds on them.

## Rules for every module

From the brief and Peter's standing rules:

- Bun 1.4.0 only. No Node runtime ships. CI may run the npm CLI for the publish step only (ADR-0006).
- Tests sit in `__tests__/` beside the file under test, named `<file>.test.ts`, with `bun:test`. A failing test first, then the code.
- `bun run check` is green before every commit: typecheck, oxlint, oxfmt check, tests, version check.
- One commit per task. Stage the task's files by name. PRs merge with merge commits.
- Outward-facing steps (push, PR, merge, release, repo creation, visibility, npm publish, org creation) are asked once, then run as small separate shell commands.
- Verify or say unverified. Check Claude Code, GitHub Actions and npm behaviour against their current docs.
- A new command is one file and one line in the command list, with its own tests. `acmelabs --help` lists every command.
- Every repo, every package and every plugin keeps a changelog through changesets, set up as brain does: `.changeset/config.json` with `@changesets/changelog-github`, `.changeset/README.md` explaining the release flow, a `CHANGELOG.md` per package, and the `changeset` and `version` scripts. A user-facing change gets a changeset. This repo follows the rule from its first code commit.

## Test seams

Peter confirmed these on 2026-10-20 (interview QS). Every module spec names which seam its tests use. Outside programs and services (git, gh, bun, claude, the npm registry) are fakes that each test sets; files are real, in a temp folder.

| Seam | Used by | A test does |
|---|---|---|
| Command seam | every module with a command | Runs one command from the command list with typed input, a temp-folder repo and the fakes, then checks the result and the events. CLI mode, JSON mode, the MCP server and the TUI all call commands through this seam. |
| Argv seam | `cli-frontend` only | Runs `acmelabs ...` in-process through the router, with fake terminal streams that drive the clack prompts, then checks the output and the exit code. |
| Screen seam | `tui-kit`, `tui-app` | Sends key bytes in and checks the screen text that comes out, which tty's bytes-in, bytes-out design allows. |

Real-world proof stays outside unit tests: jev-gate's real release (`jev-gate-migration`), and one scratch repo from `acmelabs new` (`scaffold`), asked for before it is created.

Prior-art tests the new tests resemble: brain's `scripts/version/__tests__/version-sync.test.ts` (fixture repos in a temp folder, check mode and write mode, byte-identical second write) and `scripts/release/__tests__/release-notes.test.ts` (a pure function over a changelog string).

## Done when

The brief's done-when list, with Peter's additions from the interview:

- [ ] `acmelabs new <name>` makes a plugin repo where `bun run check` and `bun run validate` pass on the first run, CI passes on the first PR, and the first release tags `v0.1.0` and moves the latest tag. Proven by one acceptance run on a scratch repo, asked for before it is created (ADR-0010).
- [ ] `acmelabs new <name>` makes a library repo where `bun run check` passes, CI passes, and the first Version Packages PR merge publishes 0.1.0 from CI with provenance (ADR-0006).
- [ ] A new repo references the shared pieces and copies none of them. Its `package.json` scripts call `acmelabs` for version sync, release notes and validate.
- [ ] A new repo protects main with the "Protect main" ruleset and enables agent-skills and brain at project scope (ADR-0011).
- [ ] A new repo has changesets set up as brain does, written from its repo config: `.changeset/config.json`, `.changeset/README.md`, `CHANGELOG.md` per package, and the `changeset` and `version` scripts.
- [ ] This repo's two packages and its plugin each keep a changelog through changesets.
- [ ] A new repo starts with this repo's record layout: `AGENTS.md` with the session start and end routine and the rules for questions and research (every question to the owner through the ask-user-question skill; research lands in files), a root `CLAUDE.md` that imports it and names which plugin runs which phase, `CONTEXT.md`, `docs/STATUS.md`, `docs/design/`, `docs/decisions/`, `docs/research/` with its index, `tasks/`, and brain's `docs/agents/` files.
- [ ] `acmelabs marketplace add` adds a plugin repo to acmelabs-15/marketplace under the marketplace's conventions, and `claude plugin validate . --strict` passes on the marketplace afterwards.
- [ ] The marketplace README has a short "Add a plugin" section that points to `acmelabs new` and `acmelabs marketplace add`.
- [ ] jev-gate runs on the shared pieces with no behaviour change: `bun run check` and `bun run validate` pass, and its next release still tags `v<version>` and moves the latest tag.
- [ ] `@acmelabs/cli` and `@acmelabs/config` are on npm through the placeholder path, published from CI with provenance.
- [ ] The shared workflows have a `v1.0.0` release and a `v1` tag in acmelabs-15/.github.
- [ ] `acmelabs` with no command opens the TUI. Every command runs in CLI mode and in JSON mode, and `acmelabs mcp` serves every command.
- [ ] The agent guide's skill is generated from the command list, and a test fails when they disagree.
- [ ] `acmelabs upgrade` upgrades the running copy, and says so when it is already the latest.
- [ ] `acmelabs --help` lists every command, and adding a command follows the rule above.

## Out of scope for this pass

- Changing what any plugin does.
- The `create-acmelabs` shim (ADR-0004).
- A link from plugin-kit's plugin-creator to `acmelabs new`. plugin-kit is not the standard for ACMElabs plugin creation.
- Migrating ask-user-question and brain. Plan them; do them later, one PR each.
- Reviving acmelabs-15/package, acmelabs-15/agx or `@acmelabz/agent-plugin`.

## Open questions

| # | Question | Blocks | Next step |
|---|---|---|---|
| 1 | ~~The test seams~~ Settled 2026-10-20: the three seams under "Test seams" | none | none |
| 2 | ~~What job `@bomb.sh/args` does~~ Settled 2026-10-20: the router alone; args is not added (ADR-0009) | none | none |
| 3 | Does the vendored `@clack/ui` preview work on tty 0.9 under Bun, and does a Bubbles-style text input and multi-select feel right? | `tui-kit` | A prototype, through the prototype skill |
| 4 | Do oxlint and oxfmt load a TypeScript config under Bun with no Node on PATH? (UNVERIFIED) | `config-presets` | A probe in that module's spec |
| 5 | ~~Where the repo config lives~~ Settled 2026-10-20: `acmelabs.json` at the repo root | none | none |
| 6 | Which plugin's skill runs on a shared name in a new repo: agent-skills (awaken-the-slumberer's rule) or brain? | `scaffold` | Ask Peter in that module's spec |
| 7 | How do Codex, Gemini CLI and Antigravity CLI enable plugins at project scope, if they can? | `scaffold` | Research, written to `docs/research/` |
| 8 | A Version Packages PR opened by `GITHUB_TOKEN` now starts its CI runs in an approval-required state. Does "CI passes on the first PR" accept one manual approval, or do the shared workflows need a GitHub App token? | `shared-workflows` | Ask Peter in that module's spec |
| 9 | Can CI publish with `bunx npm@12` under Bun, so no Node is installed at all? npm 12.2.0 runs under Bun 1.4.0; its trusted publishing there is UNVERIFIED | `shared-workflows` | A probe in that module's spec |
| 10 | A fresh ACMElabs plugin-creation skill, made for this CLI | after `scaffold` | A later pass |
| 11 | In this workspace, changesets versions the packages under `packages/`, not the root. Where does the agent-guide plugin's version and changelog live: a private workspace package for the plugin, or the plugin's version tied to `@acmelabs/cli`? This also decides whether the marketplace entry points at the repo root or a subfolder | `agent-guide`, `cli-release` | Research the marketplace's subfolder sources, then ask Peter |
| 12 | The vendored `@clack/ui` is a workspace package that is not on npm. `@acmelabs/cli` must bundle it into its build output and must not list it as a dependency | `tui-kit`, `cli-release` | Settle in the `tui-kit` spec |
| 13 | Claude Code's plugin dependency ranges resolve `<name>--v<version>` tags; ACMElabs repos tag `v<version>` | none in this pass | Note for later |
