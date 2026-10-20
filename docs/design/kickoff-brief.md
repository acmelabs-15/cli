# Kickoff brief

The brief for the ACMElabs CLI, as Peter wrote it, and the changes Peter made to it during the spec interview. The brief is history. Where it differs from the spec (`spec/`) or a decision record (`docs/decisions/`), the spec and the decision records win.

Source: `~/Dev/ACMElabs/acmelabs-cli-PROMPT.md`, pasted into the spec session on 2026-10-19. The session ran `setup-brain` (local markdown tracker), then `/brain:spec` with this brief.

## Peter's changes during the spec interview

Each row changes or adds to the brief below. The full exchange is in `docs/design/spec-interview.md`.

| Date | Change | Where the brief said |
|---|---|---|
| 2026-10-20 | Premise corrected by research: Peter owns the `@acmelabs` npm org, which already publishes `@acmelabs/design-system` through trusted publishing. `@acmelabs/cli` is not the first npm publish. | Decision 2: "this would be the first npm publish" |
| 2026-10-20 | `acmelabs new` makes library repos too, not only plugin repos. | Decision 4 recommended plugins only; done-when names plugin repos only |
| 2026-10-20 | The marketplace step is part of the `acmelabs new` flow: the CLI asks about it when the flow reaches it. | Decision 5 |
| 2026-10-20 | `acmelabs new` protects main the way brain does (the "Protect main" ruleset). | not in the brief |
| 2026-10-20 | When a library needs an npm scope that does not exist, the CLI knows how to create it as part of setup. | not in the brief |
| 2026-10-20 | Every new repo tells agents, in `AGENTS.md` and `CLAUDE.md`, to use Addy Osmani's agent-skills plugin and the brain plugin, and enables both at project scope. | not in the brief |
| 2026-10-20 | A new command upgrades the installed CLI to the latest published version when it is behind. | Out of scope: "Commands beyond the five above" |
| 2026-10-20 | A skill and an MCP server, installable in any host, teach an agent to use the CLI. Both ship in this pass. | not in the brief |
| 2026-10-20 | The CLI is a TUI by default, on `@bomb.sh/tty`, with components that align visually with Charm's Bubbles. A command called directly uses `@clack/prompts`, themed to match the TUI. A flag runs a command with no UI, for agents. | Decision 8 named gunshi and `@clack/prompts` |
| 2026-10-20 | Use bombshell's `@bomb.sh/router` and `@bomb.sh/args`. | Decision 8 |
| 2026-10-20 | plugin-kit is not the standard for ACMElabs plugin creation. A fresh plugin-creation skill made for this CLI may come later. | Decision 7 |
| 2026-10-20 | Everything the interview settles is saved to Markdown in this repo, in the layout of `~/Dev/awaken-the-slumberer`. | not in the brief |
| 2026-10-20 | A research agent that delegates to sub-agents has them write their findings to Markdown files, which it then reads. | not in the brief |
| 2026-10-20 | Every repo that the CLI or TUI makes starts with the same record layout and agent rules as this repo, modelled on awaken-the-slumberer: `AGENTS.md` and `CLAUDE.md`, `CONTEXT.md`, `docs/STATUS.md`, `docs/design/`, `docs/decisions/`, `docs/research/`, `tasks/`, and the rule above. | not in the brief |
| 2026-10-20 | The two standing rules added to Peter's global `~/CLAUDE.md` also go into this repo's `AGENTS.md` and into the `AGENTS.md` of every repo the CLI makes: every question to Peter, a decision or a permission, goes through the ask-user-question skill; research lands in files. | not in the brief |
| 2026-10-20 | This repo, its packages and its plugin, and every package and plugin repo the CLI makes, keep changelogs through changesets, set up as brain does. | The brief named "changesets releases" as part of the shape, but not per package or for this repo |

## The brief as given

### Goal

Build the ACMElabs CLI, `acmelabs`. It is the one tool for ACMElabs repos, and it will grow past this pass. This pass gives it its first job: make a new ACMElabs repo start correct in one command, and keep every ACMElabs repo correct afterwards. "Correct" means the shape acmelabs-15/brain has today: Bun-only TypeScript, the lint and format gate, tests beside the code, changesets releases that tag `v<version>` and move `latest`, CI that runs the plugin validator, and an entry in acmelabs-15/marketplace.

### The problem, as it stands on 2026-10-19

Three public plugins carry their own copies of the same release machinery. A fix to the release flow has to be made by hand in each one.

| File | brain | ask-user-question | jev-gate |
|---|---|---|---|
| `.github/workflows/release.yml` | yes | yes | yes (copied from brain) |
| `.github/workflows/ci.yml` | yes | no | yes (copied from brain) |
| version sync script | `scripts/version/version-sync.ts` | `scripts/sync-version.ts` | `scripts/version/version-sync.ts` |
| release notes script | `scripts/release/release-notes.ts` | `scripts/release-notes.ts` | `scripts/release/release-notes.ts` |
| `.changeset/config.json` | yes | yes | yes |
| `oxlint.config.ts`, `oxfmt.config.ts` | yes | no | yes (copied from brain) |
| `tsconfig.json`, `bunfig.toml` | yes | `tsconfig.json` only | yes |

A tool that only copies templates makes this worse: each new repo is one more copy to fix by hand.

### What exists, and what not to build on

- **acmelabs-15/brain** is the reference shape. Read its `AGENTS.md`, `package.json`, `.changeset/README.md`, `.github/workflows/`, `scripts/version/`, `scripts/release/`, `scripts/validate.ts`, `oxlint.config.ts` and `oxfmt.config.ts` before you write the spec. Its release flow:
  1. A user-facing change gets a changeset.
  2. On a push to main with pending changesets, `changesets/action` opens a `ci: Version Packages` PR. That PR bumps `package.json`, rewrites `CHANGELOG.md`, and runs `version:sync` so every host manifest agrees.
  3. Merging it lands a commit with no changesets left. The workflow then creates the `v<version>` tag and a GitHub release from that version's changelog section, and moves the `latest` tag. A pre-release version, one with a hyphen, does not move `latest`.
- **acmelabs-15/jev-gate** is the smallest repo in that shape: a Claude Code-only plugin, so it has two host manifests instead of brain's five. It is the right first repo to move onto shared pieces, because a migration there is easy to check.
- **acmelabs-15/marketplace** is a registry and holds no plugin code. Its conventions, from its README:
  - Each plugin lives in its own repo.
  - There is one registry file per host: `.claude-plugin/marketplace.json` for Claude Code and `.agents/plugins/marketplace.json` for Codex. A Claude Code-only plugin goes in the Claude Code file only.
  - An entry's source is the full HTTPS URL with `ref: latest`, for example `{ "source": "url", "url": "https://github.com/acmelabs-15/<repo>.git", "ref": "latest" }`. The `owner/repo` shorthand resolves to SSH and fails on machines with no SSH key.
  - Entries carry no version string; the `latest` tag decides what installs.
  - The README's "Plugins" table gets one row per plugin.
  - The registry has no CI. `claude plugin validate . --strict` is the check.
- **acmelabs-15/.github** is public and is the conventional home for organization-wide reusable workflows.
- **acmelabs-15/plugin-kit** authors what goes inside a plugin (skills, agents, hooks, MCP servers, commands) and audits it. The CLI builds the repo around a plugin. Its `plugin-creator` skill could call `acmelabs new` as its first step. Decide in the spec whether that link is in scope.
- **acmelabs-15/package**, **acmelabs-15/agx** and the `@acmelabz/agent-plugin` project touch on this but are old. Peter's call: they do not do it the best way. Do not build on them.

### Recommended shape (decide in the spec; recommendation, not settled)

One CLI and the shared pieces it works with. Nothing is copied into a repo that the CLI or a shared workflow can provide.

| Name | Default | Note |
|---|---|---|
| Repo | `acmelabs-15/cli` | |
| npm package | `@acmelabs/cli` | Only if Peter owns the `@acmelabs` scope; see decision 2 |
| Command | `acmelabs` | Not `acme`, which collides with other tools such as acme.sh |

First commands, this pass:

| Command | Replaces | What it does |
|---|---|---|
| `acmelabs new <name>` | copying brain by hand | Asks for the description and hosts, then writes a repo that references the shared pieces instead of copying them. Optionally creates the GitHub repo and pushes. |
| `acmelabs version sync` / `acmelabs version check` | each repo's version sync script | Writes or checks `package.json`'s version in every host manifest the repo declares. |
| `acmelabs release notes <version>` | each repo's release notes script | Prints that version's `CHANGELOG.md` section for the GitHub release. |
| `acmelabs validate` | each repo's `scripts/validate.ts` | Runs the validator for each host the repo declares. |
| `acmelabs marketplace add` | editing acmelabs-15/marketplace by hand | Adds the entry and README row under the registry's conventions, validates, and opens the PR. |

The shared pieces:

- a reusable release workflow, and probably a reusable CI workflow, in acmelabs-15/.github, called with `uses: acmelabs-15/.github/.github/workflows/<name>.yml@<tag>`. The workflows call the CLI for version sync, release notes and validate;
- lint, format and tsconfig presets that each repo extends, carrying brain's two stated deviations from Ultracite (`printWidth: 100`, `trailingComma: "all"`) and its rule relaxations with their reasons. Where they live (inside `@acmelabs/cli`, or a separate presets package) is part of decision 2.

Each repo declares its hosts and manifests in one place, such as a field in `package.json` or an `acmelabs.json`, so every command and workflow reads the same list.

The CLI will gain commands after this pass. Structure it so a new command is one file and a registration line, with its own tests, and so `acmelabs --help` lists every command. Peter has used `gunshi` and `@clack/prompts` in Bun before; weigh them against Bun's built-in argument parsing.

Optionally, a tiny `create-acmelabs` package makes `bun create acmelabs <name>` work by calling `acmelabs new`. Bun resolves `bun create <x>` to an npm package named `create-<x>`; check that against Bun's docs.

Then move existing repos onto the shared pieces one at a time: jev-gate first, then ask-user-question, then brain. Each move must change no behavior. Proof for each move: `bun run check` and `bun run validate` pass, and the next release still tags `v<version>` and moves `latest`.

### Decisions for the spec interview

Ask each one through the ask-user-question skill, one per call, with a recommendation.

1. **Scope.** The CLI with the shared pieces (recommended), or the CLI's `new` command alone with templates copied into each repo, as today.
2. **Names and npm.** Check who owns the `@acmelabs` npm scope before settling `@acmelabs/cli`. Peter's agent-plugin project uses `@acmelabz`, which hints the `s` spelling may be taken. Settle where the presets live, and whether the `create-acmelabs` shim ships. All ACMElabs packages are `"private": true` today, so this would be the first npm publish. It needs an npm account or org, and a publish token stored as a repo secret. Settle the alternatives too: npm with `bunx`, `bunx github:acmelabs-15/cli`, or a Bun single-file binary on GitHub releases.
3. **Hosts.** Claude Code only, or brain's set (Claude Code, Codex, Gemini CLI, Antigravity CLI), chosen per repo when scaffolding. The host set decides which manifests exist and which ones version sync writes.
4. **Kinds of repo.** Only Claude Code plugins, or also libraries and apps such as acmelabs-15/design-system (public, Lit web components). The release flow differs: plugins follow `latest`; libraries publish to npm.
5. **How far `acmelabs new` goes on GitHub.** Write files only, or also create the repo, push, set visibility, and open the marketplace PR. Anything outward-facing is asked once before it runs.
6. **Shared-workflow versioning.** How repos pin the reusable workflows (`@v1` tag, `@main`, or a commit SHA), and how a change reaches them.
7. **plugin-kit link.** Whether `plugin-creator` calls `acmelabs new`.
8. **Command structure.** The framework for commands and prompts, and the rule a future command follows to join the CLI.

### Constraints

- Bun 1.4.0 only. No Node runtime, no Python.
- Tests in `__tests__/` beside the file under test, named `<file>.test.ts`, using `bun:test`. A failing test first, then the code.
- The gate is `bun run check`: typecheck, oxlint, oxfmt check, tests, version check. It is green before every commit.
- One commit per task. Stage the task's files by name.
- PRs merge with merge commits.
- Outward-facing steps (push, PR, merge, release, repo creation, visibility, npm publish) are asked once, then run as small separate shell commands.
- Verify or say unverified. Check Claude Code and GitHub Actions behavior against their current docs; both change fast.

### Done when

- `acmelabs new <name>` creates a new plugin repo where `bun run check` and `bun run validate` pass on the first run, CI passes on the first PR, and the first merge to main tags `v0.1.0` and moves `latest`.
- The new repo references the shared pieces and copies none of them. Its `package.json` scripts call `acmelabs` for version sync, release notes and validate.
- `acmelabs marketplace add` adds the repo to acmelabs-15/marketplace under the registry's conventions above, and `claude plugin validate . --strict` passes on the registry afterwards.
- jev-gate runs on the shared pieces with no behavior change, as the first migration.
- The marketplace README has a short "Add a plugin" section that points to `acmelabs new` and `acmelabs marketplace add`.
- `acmelabs --help` lists every command, and adding a command follows the rule from decision 8.

### Out of scope

- Changing what any plugin does.
- Commands beyond the five above. Note ideas for later in the spec's open questions.
- Migrating ask-user-question and brain in this pass. Plan them; do them later, one PR each.
- Reviving acmelabs-15/package, acmelabs-15/agx or `@acmelabz/agent-plugin`.
