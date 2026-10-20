# ACMElabs CLI

`acmelabs` is the one tool for [ACMElabs](https://github.com/acmelabs-15) repos. It makes a new repo start in the ACMElabs shape and keeps every repo in that shape afterwards.

**Status:** in development. The spec is written and approved module by module; the first module, `repo-model`, is being built. Nothing is on npm yet.

## What it will do

| Command | What it does |
|---|---|
| `acmelabs new <name>` | Makes a new plugin repo or library repo that references the shared pieces instead of copying them, creates it on GitHub, and offers the marketplace entry. |
| `acmelabs version sync`, `acmelabs version check` | Writes or checks `package.json`'s version in every manifest of the repo's hosts. |
| `acmelabs release notes <version>` | Prints one version's section of `CHANGELOG.md`, for the GitHub release. |
| `acmelabs validate` | Runs the validator of each host the repo declares. |
| `acmelabs marketplace add` | Adds a plugin repo to [acmelabs-15/marketplace](https://github.com/acmelabs-15/marketplace) and opens the PR. |
| `acmelabs upgrade` | Upgrades the running copy to the latest published version. |
| `acmelabs mcp` | Serves every command to an agent over MCP. |

`acmelabs` with no command opens a full-screen TUI. A command called directly runs in CLI mode, with prompts for missing inputs. `--json` runs it with no prompts and prints one JSON result, for agents and scripts.

## What this repo holds

| Path | What |
|---|---|
| `packages/cli/` | `@acmelabs/cli`, the CLI |
| `packages/config/` | `@acmelabs/config`, the shared lint, format and TypeScript presets |
| the repo root | the agent-guide plugin: a skill and the MCP entry that teach an agent the CLI, for Claude Code, Codex, Gemini CLI and Antigravity CLI |

The packages and the plugin arrive module by module.

## Read more

| For | Read |
|---|---|
| Where the work stands | [`docs/STATUS.md`](docs/STATUS.md) |
| The modules, their build order, and what "done" means | [`spec/README.md`](spec/README.md) |
| The words this project uses | [`CONTEXT.md`](CONTEXT.md) |
| Why each choice was made | [`docs/decisions/`](docs/decisions/) |
| The research behind the facts | [`docs/research/`](docs/research/) |
| The original brief and the interview | [`docs/design/`](docs/design/) |
| Rules for coding agents working here | [`AGENTS.md`](AGENTS.md) |
