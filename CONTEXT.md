# ACMElabs CLI

The one tool for ACMElabs repos. It makes a new repo start in the ACMElabs shape and keeps every repo in that shape afterwards.

## Language

### Repos and releases

**ACMElabs repo**:
A repository in the acmelabs-15 GitHub organization that follows the ACMElabs shape: Bun-only TypeScript, the lint and format gate, tests beside the code, changesets releases.
_Avoid_: project, package (for the whole repo)

**Gate**:
The checks an ACMElabs repo passes before every commit, run together by `bun run check`: typecheck, lint, format check, tests and the repo's own checks.
_Avoid_: quality gate, pre-commit

**Repo kind**:
What a repo releases: a plugin, a library, or both. Each kind brings its own release flow.
_Avoid_: type, template

**Plugin repo**:
An ACMElabs repo that releases by moving its latest tag, which hosts install from.

**Library repo**:
An ACMElabs repo that releases by publishing to npm.
_Avoid_: package repo

**Repo config**:
The one declaration of a repo's kind and hosts that every command and shared workflow reads.
_Avoid_: settings, metadata, manifest

**Release flow**:
The path from a changeset to a published release: the Version Packages PR, its merge, then the release tag, and for a plugin repo the latest tag, or for a library repo the npm publish.

**Version Packages PR**:
The pull request that changesets opens on main, which bumps the version and rewrites the changelog. Merging it is the human approval of a release.
_Avoid_: release PR

**Release tag**:
The fixed `v<version>` git tag cut for each release.

**Latest tag**:
The moving git tag that points at a plugin repo's newest non-pre-release release. The marketplace follows it.
_Avoid_: latest release, stable

**Placeholder version**:
The public `0.0.0-stage` version that creates a new npm package, so its trusted publisher can be set before the first real release.

**Trusted publisher**:
npm's link between a package and one CI workflow, which lets that workflow publish with no token.

**Migration**:
Moving an existing ACMElabs repo onto the shared pieces with no change in what the repo does.
_Avoid_: port, upgrade (for a repo)

**Protect main**:
The repository ruleset on an ACMElabs repo's default branch that blocks force-pushes and deletion, with no one allowed to bypass it.
_Avoid_: branch protection (GitHub's older, separate feature)

**Actions setting**:
The two GitHub Actions settings of a repo that the release flow needs: workflows get a read-only token by default, and workflows may create and approve pull requests.
_Avoid_: workflow permissions (for the pair)

### Shared pieces

**Shared pieces**:
The shared workflows and the presets: what an ACMElabs repo references instead of copying.
_Avoid_: templates, boilerplate

**Shared workflow**:
CI or release workflow code kept once, in acmelabs-15/.github, and called by every ACMElabs repo.
_Avoid_: reusable workflow copy, workflow template

**Workflow line**:
The major version a repo follows for the shared workflows, such as `v1`. A repo on a line gets every release in that line automatically.

**Preset**:
A shared lint, format or TypeScript configuration that a repo imports and builds on.
_Avoid_: base config, template

**Deviation**:
A setting in which a preset differs from the Ultracite preset it starts from, kept with its reason.
_Avoid_: relaxation (for all of them), override

**Thin caller**:
A small file in a repo that uses a shared piece instead of copying it: a workflow that calls a shared workflow, a config file that imports a preset, or a `package.json` script that calls `acmelabs`.
_Avoid_: wrapper, shim, stub

### Hosts and plugins

**Host**:
An agent program that loads a plugin: Claude Code, Codex, Gemini CLI or Antigravity CLI.
_Avoid_: harness, platform, target, agent

**Manifest**:
A host's JSON file that names a plugin and holds its version.
_Avoid_: config, plugin file

**Validator**:
A host's own check of a plugin, such as `claude plugin validate`. Not every host has one.

**Project plugins**:
The plugins a repo enables for every agent that works in it: agent-skills and brain.

### Marketplace

**Marketplace**:
acmelabs-15/marketplace, the list of ACMElabs plugins that hosts install from. It holds no plugin code.
_Avoid_: catalog, store

**Registry file**:
The marketplace's file for one host, which lists that host's entries.
_Avoid_: registry (bare), marketplace.json (in prose)

**Entry**:
One plugin's record in a registry file. It points at the plugin repo's latest tag and carries no version.

### The CLI

**Command**:
One thing the CLI does, such as `version sync`, declared once with its inputs.

**Command line**:
The words that start one outside program, such as `gh auth status`, as a validator or a step of a command holds them.
_Avoid_: command (for these words)

**Command list**:
The one list of commands that every front-end, the help output and the agent guide read.
_Avoid_: registry, router (for the list itself)

**Front-end**:
One way to drive a command: the TUI, CLI mode, JSON mode or the MCP server.
_Avoid_: interface, UI (for all front-ends together)

**TUI**:
The full-screen front-end that `acmelabs` opens when no command is named.

**CLI mode**:
The front-end for a command called directly in a terminal, with inline prompts for missing inputs.

**JSON mode**:
The front-end with no prompts and no styling, for agents and scripts. It prints one JSON result.
_Avoid_: headless, silent mode

**Component**:
One reusable piece of the TUI, such as a text input or a list, in the look of Charm's Bubbles.
_Avoid_: widget

**Question**:
An optional input that a command asks for mid-run, when the moment comes. A value given up front answers it; otherwise a terminal asks it, or the command ends with an input error that names its flag.
_Avoid_: prompt (for the question itself; a prompt is how a terminal asks it)

**World**:
The outside world a command reaches: programs, the network and the environment.

**Progress update**:
One step's change or one message, sent while a command runs. A step has a stable id and a title for people.

**Outcome**:
How one run of a command ends: its result, or its failure with an exit code.

**Failure kind**:
How a command failed: problem, input, outside, login, cancelled or bug, each with its own exit code. A bug is in acmelabs itself, never in the repo or the input.
_Avoid_: defect (for a bug)

**Agent guide**:
The skill and the MCP server that teach an agent how to use the CLI.
_Avoid_: docs, manual

**Running copy**:
The install of the CLI that is executing now: a repo's pinned copy or the global install.

**Editor schema**:
The JSON schema, shipped in `@acmelabs/cli`, that an editor checks `acmelabs.json` against.
_Avoid_: schema file, JSON schema for editors
