# Spec interview record

Working record of the spec interview for the ACMElabs CLI (`/brain:spec`, run through `spec-driven-development`). Each question went to Peter one at a time through `AskUserQuestion`, with the facts and a recommendation inside it. Answers land here as they arrive. When the interview ends, the spec in `spec/` holds the result and this file stays as history. Where they differ, the spec and `docs/decisions/` win.

Started 2026-10-19 in the Claude Code session that created this repo. The brief and Peter's dated changes to it are in `docs/design/kickoff-brief.md`. The research behind each fact is in `docs/research/`.

## Setup (setup-brain, 2026-10-19)

| Item | Result | Who decided |
|---|---|---|
| Repo | `~/Dev/ACMElabs/cli`, `git init -b main`, no remote yet. `acmelabs-15/cli` does not exist on GitHub yet. | the brief |
| Layout | Single context: one `CONTEXT.md` at the root. The repo was empty, with no monorepo signals. | agent (small, reversible) |
| Codex plain-talk block | Global scope. The block was already in `~/.codex/AGENTS.md`, so the script left it unchanged. | agent (already in place) |
| Issue tracker | Local markdown under `.scratch/`. The agent recommended GitHub issues. | Peter |
| ADR folder | `docs/decisions/`, as in brain 0.6.0 and awaken-the-slumberer. The installed brain 0.5.0 wrote `docs/adr/` into `docs/agents/domain.md`; that line was corrected on 2026-10-20. | agent (matches the newer brain) |

## Question order

| # | Topic | Status |
|---|---|---|
| 1 | Scope | settled |
| 3 | Hosts | settled (after one repair) |
| 4 | Kinds of repo | settled |
| 5 | How far `acmelabs new` goes on GitHub | settled, with additions |
| 2a | How repos get the CLI | settled |
| 2b | Where the presets live | settled |
| 2c | The `create-acmelabs` shim | settled |
| A1 | Plugins in new repos | settled |
| A2 | Agent guide: skill, MCP server, or both | settled |
| 8a | Front-ends (TUI, CLI, no UI) | settled |
| A3 | Which install `upgrade` upgrades | settled |
| A4 | What a library package contains | settled |
| A5 | First version of a new npm package | settled |
| A6 | What the trusted publisher allows | settled |
| A7 | Where the agent-guide plugin lives | settled |
| 8b | Argument parser for direct calls | settled, then changed (see 8c) |
| 6 | How a shared-workflow fix reaches each repo | settled (after one repair) |
| 7 | plugin-kit link | settled |
| A8 | TUI base | settled (after two repairs) |
| A9 | How we use the `@clack/ui` preview | settled |
| M | Capability map | approved |
| S | Test seams | settled |
| 8c | `@bomb.sh/router` and `@bomb.sh/args` | settled |

Numbers 1 to 8 are the brief's decisions. A-numbers are questions that Peter's additions raised.

## Answers

### Q1. Scope — settled 2026-10-19

- **Facts given:** brain and jev-gate carry copies of the same release machinery, and the copies already drift. brain's lint config already imports a preset object from ultracite. acmelabs-15/.github holds only a BugBot workflow.
- **Recommended:** the CLI with shared pieces.
- **Answer:** the CLI with shared pieces. Reusable workflows in acmelabs-15/.github, shared presets, thin callers in each repo.

### Q3. Hosts — settled 2026-10-20

- **First version of the question** listed manifests and validators per host. Peter answered `/wait-what`. Defect: a missing premise. "Host" and "manifest" had no definition, and the validator facts did not bear on the choice.
- **Repaired question:** a host is an agent program that loads a plugin (Claude Code, Codex, Gemini CLI, Antigravity CLI). Each host reads its own manifest, a JSON file with the plugin's name and version.
- **Recommended:** all four hosts, chosen per repo, Claude Code the default.
- **Answer:** all four hosts. `acmelabs new` asks which hosts a new plugin targets; Claude Code is preselected.

### Q4. Kinds of repo — settled 2026-10-20

- **Facts given:** a plugin repo releases with the `latest` tag; a library repo releases with an npm publish. design-system is a library with its own flow (four packages, browser tests, Pages, no changesets).
- **Recommended:** plugins only in this pass.
- **Answer:** plugins and libraries. Effect: the shared release workflow needs an npm publish path, and `acmelabs new` needs a library template.

### Q5. How far `acmelabs new` goes on GitHub — settled 2026-10-20

- **Facts given:** done-when needs a GitHub repo. The changesets Version Packages PR needs the Actions setting "allow GitHub Actions to create and approve pull requests"; brain and jev-gate have it on.
- **Recommended:** write, install, first commit, then ask once and create the repo, set visibility and the Actions setting, and push. The marketplace stays its own command.
- **Answer (Peter's words):** "adding the marketplace should be part of the flow and it should be something that the CLI or TUI knows to ask as part of its workflow whenever it gets there. Additionally, like brain, the main branch automatically be set up to be protected."
- **Facts found after the answer:** brain protects main with a repository ruleset named "Protect main": it blocks force-push (`non_fast_forward`) and deletion on the default branch, with no bypass actors and no required checks. jev-gate has no protection.
- **Agent's call (small, reversible):** after the push, `new` waits for the first release run. When the `latest` tag exists, it asks whether to add the plugin to the marketplace. When the run fails or Peter says no, it prints `acmelabs marketplace add` for later. Library repos skip this step.

### Q2a. How repos get the CLI — settled 2026-10-20

- **Facts given:** Peter owns the `@acmelabs` npm org; it publishes `@acmelabs/design-system` through trusted publishing; `@acmelabs/cli` is free. The local npm login is rejected (401). `bun publish` has no trusted publishing, so CI publishes with npm on Node, as design-system does. A GitHub dependency needs exact tags. A compiled binary is about 64 MB.
- **Recommended and answered:** npm, `@acmelabs/cli`, pinned in each repo's devDependencies.

### Q2b. Where the presets live — settled 2026-10-20

- **Facts given:** oxlint inherits only the rules of an imported preset; oxfmt has no `extends`, so a repo spreads the imported object; tsconfig extends a package path.
- **Recommended:** inside `@acmelabs/cli`.
- **Answer:** a separate package, `@acmelabs/config`, in the same repo as a workspace. The name is free on npm.

### Q2c. The `create-acmelabs` shim — settled 2026-10-20

- **Recommended and answered:** a later pass. This pass ships `@acmelabs/cli` and `@acmelabs/config` only. The start command is `bunx @acmelabs/cli new <name>`.

### Mid-interview addition: npm scope creation (2026-10-20)

- **Peter:** "if a new namespace needs to be created for the NPM package that needs to be published, the CLI should know how to do that / be able to do that as part of its setup."
- **Facts found:** only the npm website creates an org. The CLI can open `https://www.npmjs.com/org/create` and poll the registry until the scope exists. Login, first publish and trusted-publisher setup can run under Bun with fetch; each needs Peter's password or 2FA. See `docs/research/04-npm-scope-login-trust.md`.

### Q6, first attempt (2026-10-20)

Peter declined the question ("doesn't want to take this action right now") and added requirements instead. It was asked again later; see Q6 below.

### QA1. Plugins in new repos — settled 2026-10-20

- **Peter's requirement:** new repos tell agents to always use Addy Osmani's agent-skills plugin and the brain plugin, in `AGENTS.md` or `CLAUDE.md`, and set both up at project scope automatically.
- **Facts given:** brain vendors agent-skills' 25 skills unchanged and owns 8 of them under the same names. With both enabled, every lifecycle skill shows twice, and an agent can pick the copy without brain's additions. Project scope is `.claude/settings.json` with `enabledPlugins` and `extraKnownMarketplaces`.
- **Recommended:** brain only.
- **Answer:** both plugins. The duplicate-skill cost is accepted and recorded.
- **Precedent found later:** `~/Dev/awaken-the-slumberer` enables both, and its `CLAUDE.md` says: "When both plugins carry a skill with the same name, run the agent-skills version." Which version wins in new ACMElabs repos is an open question for the `scaffold` module spec.

### Mid-interview addition: upgrade command (2026-10-20)

- **Peter:** "The CLI/TUI should also have a command that will automatically upgrade the currently installed version to the latest version if it isn't the latest published version already."

### QA2. Agent guide — settled 2026-10-20

- **Peter's requirement:** "just like Claude Code provides, there should be either a skill or an MCP or both that can be installed to any harness ... that teaches or enables an agent to learn how to use the TUI/CLI."
- **Recommended:** a skill now, generated from the command list; MCP later.
- **Answer:** both now, the skill and an `acmelabs mcp` server.

### Q8a. Front-ends — settled 2026-10-20

- **Question:** gunshi + clack, parseArgs + clack, or a full-screen TUI on `@bomb.sh/tty`.
- **Answer (Peter's words, two messages):** "probably option three ... creating components that visually align with charmbracelet/bubbles that enable functionalities like these examples (bubbletea/examples) ... similar to Claude Code TUI, allowing certain things to be run programmatically without the TUI interface probably also makes sense." Then: "have it be a TUI by default, and when commands that run programmatically where it would be helpful for them to have a CLI functionality when called directly they should use clack, and the clack UI should be updated/customized so that it matches/is thematically aligned with the TUI UX/UI we create. Additionally for any of the CLI commands that can be directly called, perhaps also have a flag passed that allows them to be run without a CLI UI for things like an AI to use."
- **Result:** one command list, three front-ends:

  | Mode | When | Built on |
  |---|---|---|
  | TUI | `acmelabs` with no command | `@bomb.sh/tty`, components that look like Bubbles |
  | CLI mode | `acmelabs <command>` in a terminal | `@clack/prompts`, themed to match the TUI |
  | JSON mode | `acmelabs <command> --json`, and the MCP server | no prompts, no colour, one JSON result |

- **Agent's calls (small, reversible):** the flag is `--json`. A command never prompts without a terminal; a missing input is an error that names the flag.

### QA3. Which install `upgrade` upgrades — settled 2026-10-20

- **Recommended and answered:** the running copy. In a repo it bumps the exact pins of `@acmelabs/cli` and `@acmelabs/config` and runs `bun install`; globally it updates the global install; it prints "already latest" when nothing changes.

### QA4. What a library package contains — settled 2026-10-20

- **Facts given:** Node cannot run TypeScript files inside `node_modules`. oxlint and oxfmt load a TypeScript config through Node, and that config imports the `@acmelabs/config` presets.
- **Recommended and answered:** built JavaScript plus `.d.ts` type files, made with `bun build` and `tsc`, for every library, `@acmelabs/cli` and `@acmelabs/config` included.

### QA5. First version of a new npm package — settled 2026-10-20

- **Facts given:** trusted publishing cannot create a package. A new trusted publisher expires after 48 hours unless CI publishes with it. Since 2026-10-02, a stage publish can create a package and leaves a public placeholder version, `0.0.0-stage`.
- **Recommended and answered:** placeholder, then CI. `new` creates the package and the trusted publisher from Peter's machine with 2FA; the first Version Packages PR merge publishes 0.1.0 from CI with provenance. The same path applies to `@acmelabs/cli` and `@acmelabs/config`.

### QA6. What the trusted publisher allows — settled 2026-10-20

- **Facts given:** a trusted publisher made after 2026-09-03 allows only a stage publish by default; direct publish is opt-in.
- **Recommended and answered:** direct publish. The Version Packages PR merge is the human approval.

### QA7. Where the agent-guide plugin lives — settled 2026-10-20

- **Recommended:** a separate repo, `acmelabs-15/acmelabs-plugin`, made by `acmelabs new`.
- **Answer:** inside the cli repo. Effect: the cli repo runs both release flows (npm for its packages, the `latest` tag for the plugin), and the done-when for `acmelabs new` needs a separate acceptance run.

### Q8b. Argument parser for direct calls — settled 2026-10-20, then changed

- **Recommended and answered:** gunshi 1.0.0-rc.1, verified on Bun.
- **Changed by Peter in the test-seams answer (see 8c):** use bombshell's `@bomb.sh/router` and `@bomb.sh/args`.

### Q6. How a shared-workflow fix reaches each repo — settled 2026-10-20

- **Second attempt** used "pin", "ref", "SHA" and "moving tag". Peter answered `/wait-what`. Defect: unknown terms, and no statement of the problem they solve.
- **Repaired question:** each repo's workflow file names which version of the shared code it uses; that name decides how a fix gets to each repo.
- **Recommended and answered:** automatic. Each repo uses the newest release in the `v1` line; a breaking change gets `v2`. The shared repo needs its own tests before each release.

### Q7. plugin-kit link — settled 2026-10-20

- **Recommended:** a later pass.
- **Answer (Peter's words):** "I'm not really sure if I ever got this to a place that I wanted it to be. I'm not totally sure this should be the standard we use for the plugin creation here. We might want to just create our own fresh skill for creating plugins that is specific to this thing's need. Maybe."
- **Result:** no link to plugin-kit. A fresh ACMElabs plugin-creation skill is an open question for after `acmelabs new` exists; it is not in this pass.

### QA8. TUI base — settled 2026-10-20

- **First version** compared OpenTUI, tty with our own components, and Ink, and recommended OpenTUI. Peter asked: "is there a preview or beta of @clack/ui available?"
- **Facts found:** not on npm; a pkg.pr.new preview at commit `a60ac12`, version 0.0.0, MIT, from the non-public repo `bombshell-dev/ui`, holding only `box`, `text` and a render root.
- **Second version** carried that fact; Peter answered `/wait-what`: "explain to me what @bomb.sh/tty vs OpenTUI provides and if they can be used together and if the @clack/ui package would/plans to provide the same functionality provided by OpenTUI." Defect: the explanation sat in the chat above the question, where the dialog hides it.
- **Third version** put the four layers (drawing, input, components, app) inside the question, with a preview per option. Peter chose to clarify first.
- **Answer (Peter's words):** "I'm feeling a little bit partial towards the folks who built the tty and clack libraries ... I'm tempted to stick with them and later adopt their @clack/ui package. Wondering if until then we can reference what they've started to build in the @clack/ui source ... forking it, cloning it, copying it, or using it as it exists right now and then adding to it in hopes that when they are finished with it, we can simply migrate to it."
- **Result:** the TUI runs on `@bomb.sh/tty`.

### QA9. How we use the `@clack/ui` preview — settled 2026-10-20

- **Facts given:** forking is not possible (private repo). The preview is MIT with its TypeScript source. bombshell's own playground copies it into a local package, `@clack/vendored.ui`, and builds on it with `alien-signals` for state and a focus index. The preview targets tty 0.7; the current tty is 0.9.
- **Recommended and answered:** copy it, as bombshell does. A local package pinned to commit `a60ac12`, with its license; our components follow its style; the later move is to swap the copy for the npm package and drop our components one by one as theirs ship.

### QM. Capability map — approved 2026-10-20

- **Approved:** the 16-module map in `spec/README.md`, in six layers. jev-gate moves in layer 4 to prove the shared pieces before `acmelabs new` builds on them. The TUI parts get a short prototype first.

### QS. Test seams — settled 2026-10-20

- **First attempt:** Peter's reply did not answer it; it changed the argument parser (8c).
- **Asked again** after 8c settled, with the router in place of gunshi: three seams (the command seam for every command, the argv seam for the CLI front-end, the screen seam for the TUI), with real-world proof outside unit tests.
- **Recommended and answered:** three seams. They are in `spec/README.md`, "Test seams".

### Q8c. `@bomb.sh/router` and `@bomb.sh/args` — settled 2026-10-20

- **Peter:** "I think we should also use their bombshell-dev/args and bombshell-dev/router packages."
- **Facts found (probe on Bun 1.4.0, see `docs/research/05-command-frameworks.md`):** the router works on Bun. Root `--help` lists every command, `version --help` lists `sync` and `check`, and a positional named `version` binds with no clash. Options bind to the route segment that owns them, so `--json` after a subcommand fails unless each command declares it. The router has its own tokenizer and does not use `@bomb.sh/args`.
- **Asked:** what job `@bomb.sh/args` does. Options: the router alone, or args reading global flags such as `--json` before the router runs.
- **Recommended and answered:** the router alone. `--json` is declared on every command through one shared router group. args is not added; it comes back only for a real job.

### Mid-interview additions: records and research (2026-10-20)

- **Peter:** "I hope everything we're talking about during this interview is getting saved to Markdown files, similar to how the project awaken-the-slumberer does in the docs directory as well as its CONTEXT.md, AGENTS.md, etc." Until then, the interview lived only in the conversation; the records below were written in answer.
- **Peter:** look at awaken-the-slumberer's `AGENTS.md` and `CLAUDE.md` for how they tell the agent to use agent-skills and brain, and at its `tasks/` folder for how it tracks status, plan and to-dos.
- **Peter:** "When doing research, a sub agent that delegates any sub agents should have those sub agents write its research to markdown files that it can then read as opposed to asking them to return a message to itself because those often fail."
- **Peter:** those record files and rules "should probably also be part of the new code bases that the CLI or TUI creates." Effect: a done-when item and part of the `scaffold` module.

## Records written on 2026-10-20

Peter asked that everything from the interview be saved to Markdown in the layout of `~/Dev/awaken-the-slumberer`. This file, `docs/design/kickoff-brief.md`, `docs/research/`, `docs/decisions/`, `CONTEXT.md`, `spec/README.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json` and `docs/STATUS.md` were written then.

### Standing rules — settled 2026-10-20

- **Peter:** "use the ask user question skill always." The agent had asked two permissions in plain text, reading the global rule as covering decisions only.
- **Asked and answered:** add both rules to `~/CLAUDE.md` §1: every question to Peter, a decision or a permission, goes through ask-user-question; research lands in files, and an agent that delegates names each sub-agent's target file.
- **Peter:** those global updates "should probably also exist in the project specific ones that we create using the CLI as well as the AGENTS.md in this project." Effect: both rules are in this repo's `AGENTS.md`, and the done-when item for a new repo's record layout names them.

### The repo name — settled 2026-10-20

- **Peter asked:** "instead of being in a directory named 'cli' should it be called 'tui'?"
- **Facts given:** the TUI is one of four front-ends, and the repo also holds `@acmelabs/config` and the agent-guide plugin. The glossary uses "TUI" for the full-screen front-end only. A rename was cheap (no remote, one commit, 7 mentions); `acmelabs-15/tui`, `acmelabs-15/acmelabs` and `@acmelabs/tui` were free.
- **Recommended and answered:** keep `cli` for the repo and the folder. The npm package stays `@acmelabs/cli`.

### Commits — settled 2026-10-20

- **Recommended and answered:** standing permission to commit at each task end and session end, with each commit reported. Pushes are asked each time. Recorded in `AGENTS.md`, "Session end".

### Where the repo config lives — settled 2026-10-20 (module `repo-model`)

- **Facts given:** this repo is both a library repo and a plugin repo (ADR-0010), so the config allows both kinds. A separate file can carry a `$schema` line that editors check; a `package.json` field cannot, and in a library it ships inside every npm package.
- **Recommended and answered:** `acmelabs.json` at the repo root. Effect on the glossary: a repo kind is a plugin, a library, or both.
- **Fact verified after the answer:** `agy plugin validate .` reads the root `plugin.json`. It passes on brain and fails on jev-gate with "missing plugin.json", as expected for a Claude Code-only plugin.

### Changelogs — added 2026-10-20

- **Peter:** "make sure there are changelogs. I think the brain codebase has a standard setup for changesets and changelog management. This repo should have all that as well. So should packages and plugins."
- **Effect:** a rule for every module in `spec/README.md`, and two done-when items. changesets cannot import its config from a shared package, so `acmelabs new` writes each repo's `.changeset/config.json` from its repo config. Open question 11 in `spec/README.md` asks where the agent-guide plugin's version and changelog live in this workspace.

### The GitHub repo — settled 2026-10-20

- **Peter:** "I just want to be sure this is getting created as a Git repo under the Acme Labs organization", then "would probably be good to push".
- **Recommended and answered:** create acmelabs-15/cli as a public repo and push main, set up like brain. npm adds provenance only when the repo and the package are both public.
- **Done:** https://github.com/acmelabs-15/cli created and main pushed; Actions setting `default_workflow_permissions: read`, `can_approve_pull_request_reviews: true`; ruleset "Protect main" (`non_fast_forward`, `deletion` on the default branch, no bypass), id 25461155.

### README and license — settled 2026-10-20

- **Peter:** "Should also probably include a readme.md as should all plugins and packages that are created by the CLI." Effect: this repo's `README.md`, a rule for every repo, package and plugin, and `packages/cli/README.md` in task 1.
- **License, recommended and answered:** MIT, the same as brain and jev-gate, with Peter Kloss as holder; MIT is also the default for new repos. `LICENSE` copied from brain.
- **Peter:** "push frequently." Standing permission to push after every commit, recorded in `AGENTS.md`.
- **Push target, recommended and answered:** a branch per module, pushed after every commit, merged into main through one PR with a merge commit at the module's checkpoint, after Peter's review. Records and docs go straight to main.

### `..` in package paths — settled 2026-10-20 (module `repo-model`, task 7)

- **Found by task 7:** the editor schema rejects any `..` in a package path, because a JSON schema cannot tell whether `..` leaves the repo; the command accepted `..` that stays inside.
- **Recommended and answered:** the command rejects any `..` too, so the two checks agree on every path. One accepted difference stays: an editor does not see `./packages/cli` and `packages/cli` as a repeat.

### Where `CLAUDE.md` lives — settled 2026-10-20

- **Peter asked:** should `.claude/CLAUDE.md` be at the root instead?
- **Facts (code.claude.com/docs/en/memory, read 2026-10-20):** a project `CLAUDE.md` loads the same from `./CLAUDE.md` or `./.claude/CLAUDE.md`. With either present, Claude Code reads `CLAUDE.md` only, and `AGENTS.md` arrives through the import, so nothing loads twice. With no `CLAUDE.md`, Claude Code 2.1.277 or later reads `AGENTS.md` directly.
- **Agent's call (small, reversible):** the root, beside the `AGENTS.md` it imports, as in awaken-the-slumberer. A `CLAUDE.md` stays, because the Claude-only rules need a file that Codex does not read. brain and jev-gate keep `.claude/CLAUDE.md` until their migrations; new repos get the root file.
