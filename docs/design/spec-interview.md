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

### Exit codes — settled 2026-10-20 (module `command-core`)

- **First version:** 0/1/2, recommended to match brain's scripts and `claude plugin validate`. Peter: "I'm feeling a little bit conflicted between option one and option two. Just to be clear, all choices or decisions that we make should be made because they're the best decision, not because they're easiest or fastest or anything like that."
- **Research then:** clig.dev says "Map the non-zero exit codes to the most important failure modes." The GitHub CLI documents 1 failure, 2 cancelled, 4 authentication required.
- **Recommended and answered:** one code per failure mode: 0 done; 1 problem found; 2 bad input or config; 3 an outside tool or service failed; 4 a login is needed; 130 cancelled by the user. Recorded in ADR-0007.

### JSON mode and progress — settled 2026-10-20 (module `command-core`)

- **First version** recommended one final answer only (clig.dev; Claude Code's `json` format). Peter answered `/wait-what`. Defect: unexplained terms (stdout, stderr, stream, contract) and an inline JSON example that hid the choice.
- **Repaired version** was interrupted. **Peter:** "I think it would be good if we provide progress. Things like Claude Code mods allow displaying information like that. And just in general, displaying progress is a very useful feedback mechanism to see, so we should always include it."
- **Result:** JSON mode prints one JSON line per progress update, then the final answer as the last line, typed `result`, as Claude Code's `stream-json` does. Recorded in ADR-0007. A Claude Code mod that shows `acmelabs` progress is an idea for `agent-guide` (open question 20 in `spec/README.md`).

### The command-core spec — approved 2026-10-20

- **Approved:** `spec/SPEC-command-core.md` as written, with one addition the agent proposed: exit code 70 (BSD's `EX_SOFTWARE`) for a defect inside acmelabs itself, so a bug never looks like "problem found". Recorded in ADR-0007.

### Where `CLAUDE.md` lives — settled 2026-10-20

- **Peter asked:** should `.claude/CLAUDE.md` be at the root instead?
- **Facts (code.claude.com/docs/en/memory, read 2026-10-20):** a project `CLAUDE.md` loads the same from `./CLAUDE.md` or `./.claude/CLAUDE.md`. With either present, Claude Code reads `CLAUDE.md` only, and `AGENTS.md` arrives through the import, so nothing loads twice. With no `CLAUDE.md`, Claude Code 2.1.277 or later reads `AGENTS.md` directly.
- **Agent's call (small, reversible):** the root, beside the `AGENTS.md` it imports, as in awaken-the-slumberer. A `CLAUDE.md` stays, because the Claude-only rules need a file that Codex does not read. brain and jev-gate keep `.claude/CLAUDE.md` until their migrations; new repos get the root file.

### The gate's runtime — settled 2026-10-20 (module `config-presets`, open question 4)

- **First version** explained the `#!/usr/bin/env node` line, PATH and `bunfig.toml`, and asked how to keep the gate on Bun. Peter answered `/wait-what`. Defects: an unclear consequence (why the runtime matters) and unexplained terms.
- **Repaired version** opened with the problem: on Peter's machine, `bun run check` runs oxlint, oxfmt and tsc on Node v24 today; results can differ between machines; one `bunfig.toml` setting makes Bun run them.
- **Recommended and answered:** `[run]` with `bun = true` in every repo's `bunfig.toml`. Peter's condition: "I want to make sure that everything actually runs on Bun, not Node." Recorded in ADR-0012; a test proves it with a `node` on PATH that fails when called.

### The test seam for `config-presets` — settled 2026-10-20

- **Facts given:** the three agreed seams test a command, a command line or a screen, and this module has none. A real run takes 0.09 s (oxlint), 0.07 s (oxfmt) and 0.88 s (tsc). oxlint's `extends` silently drops the ignore list, which only a real run shows.
- **Recommended and answered:** a sample repo in a temp folder, with thin callers that import the built presets, and the real tools run through `bun run` with a failing `node` on PATH. Added to "Test seams" in `spec/README.md`.

### The layout of `acmelabs.json` — settled 2026-10-20 (open question 18)

- **Facts given:** `formatRepoConfig` writes a 145-column line for five packages, and oxfmt rewrites it as 13 lines, so the file changes back and forth.
- **Recommended and answered:** `formatRepoConfig` writes oxfmt's layout, proven by a test that runs oxfmt on its output. Rule for later modules: every file `acmelabs` writes passes the format check unchanged.

### The config-presets spec — approved 2026-10-20

- **Approved:** `spec/SPEC-config-presets.md` as written (draft `88a0907`), with the agent's three calls: the tool versions stay as today; each repo lists oxlint, oxfmt, typescript and `@types/bun` itself, and Ultracite moves into the preset; this repo imports the presets by relative path.

### This repo's root configs under Node — settled 2026-10-20 (module `config-presets`, task 6)

- **Facts given:** the root lint and format configs import the presets' source, whose own imports have no file extension. Bun loads them; real Node fails with "Cannot find module", so an editor's oxc extension on Node would show a config error in this repo. Other repos import the built package, which loads under Node. No oxc extension is installed on Peter's machine (VS Code has ESLint and Prettier; Cursor has Biome).
- **Recommended and answered:** accept and record, in `spec/SPEC-config-presets.md` ("This repo on the presets"). Rejected: `.ts` file extensions in the presets' imports, and a build step before the gate.

### The config-presets review fixes — settled 2026-10-20

- **Facts given:** the final-checkpoint review (`docs/reviews/2026-10-20-config-presets.md`) found two Required findings, fixed in any case: the width-drift test catches only a narrower width, and the handoff note is stale. The optional findings came in three groups: code cleanups, record fixes, and bundling Ultracite's two presets into the package.
- **Recommended:** the cleanups and the record fixes now, and the bundling in `cli-release`, which owns the published shape.
- **Answer:** all three groups now, the bundling included. Recorded in ADR-0013.
- **Agent's note, same day:** the spec's `env` sentence was made exact in `a0a733d` ("The preset sets no `env`, as today's configs do"), after task 2 found it could be read two ways. The new wording matches the sentence's own reason and today's configs; no behaviour changed.

### How acmelabs talks to GitHub — settled 2026-10-20 (module `github-ops`)

- **Facts given** (`docs/research/09-github-steps.md`): gh 2.98.0 is installed, logged in with the `repo` and `workflow` scopes. `gh api` sends any REST call with gh's login (the keyring locally, `GH_TOKEN` in CI); an error gives exit 1 and GitHub's JSON error body, and no login gives exit 4. git pushes and clones with the same login through gh's credential helper, as gh itself does. gh's high-level commands print text, and `gh run watch` polls every 3 seconds. A direct call with fetch needs the token inside acmelabs.
- **Recommended and answered:** `gh api` for every REST call, and git with gh's credential helper for push and clone. One login covers the API and the push, and no token passes through acmelabs.

### What a GitHub step does on a re-run — settled 2026-10-20 (module `github-ops`)

- **Facts given:** a step can read before it writes. An existing repo can be this run's repo or another repo with the same name. It is this run's repo when it is empty, or when its main branch's newest commit is in the local history. Changing visibility from private to public makes the Actions logs public and erases stars. The gh login has no `delete_repo` scope.
- **Recommended and answered:** pick up where it stopped. Each step reads first and reports itself as skipped when its result is already there. An existing repo is reused only when it is empty or its main commit is in the local history; any other existing repo, or one with the other visibility, stops the command with exit 2 and names it.

### Environment variables for outside programs — settled 2026-10-20 (module `github-ops`, open question 21)

- **First version** offered a deny list by name, a wide allowlist, or no change, with prior art from Bazel, Turborepo and Codex. Peter answered `/wait-what`. Defects: no plain statement of the problem, unexplained terms ("deny list", "allowlist", "the redaction's name rule"), and facts that did not bear on the choice.
- **Second version** opened with the problem and explained both filters. Peter asked back: "aren't these variable values kept private - isn't that the whole point of using an env variable?" Defect: a missing premise. The question did not say that a variable is private from other users but not from the programs a process starts. It also overstated the risk: GitHub passes no secrets to a workflow that a pull request from a fork starts (docs.github.com, "Using secrets in GitHub Actions").
- **Third version** answered that first: a child program gets a copy of every variable (a probe saw all 76), and GitHub's secure-use guide says one compromised action "would have access to all secrets". The real risk is a program that acmelabs starts reading a token it does not need. A filter covers only programs that acmelabs starts.
- **Recommended:** remove by name, with the redaction's rule (TOKEN, SECRET, KEY, PASSWORD), and a per-call pass-through.
- **Answer:** no filter. Every program that acmelabs starts gets the whole environment, as today.

### Limits for outside programs and requests — settled 2026-10-20 (module `github-ops`, open question 22)

- **Facts given** (`docs/research/10-outside-program-limits.md`): nothing limits a program's time or output, or a request's time; a 200 MB flood used 599 MB; on a cancel, a program's own child kept running 10 s; every call measured ended in under 3 s, the largest output was 44 KB; gh, git and Bun's fetch have no time limit of their own; other tools' limits (Claude Code 2 min, npm 5 min, Renovate 15 min and 10 MB, Node 1 MB).
- **Recommended and answered:** both limits. Every program and request gets a time limit and an output limit that a call can raise or lower: 5 minutes per program, 1 minute per request, 10 MB per output. At a limit, acmelabs stops the program and every program it started, and the command ends with exit 3 and a message that names the limit.

### The test seams for `github-ops` — settled 2026-10-20

- **Facts given:** the command seam already runs sample commands that call gh through `fakeWorld`; the World's own tests run real `bun -e` programs in milliseconds; a fake clock lets a 30-minute wait pass at once; a real GitHub repo in a test needs the network and the login, and the login cannot delete a repo.
- **Recommended and answered:** the GitHub steps at the command seam, through sample commands with scripted gh and git answers; the limits in the World's own tests, with real `bun -e` programs and a local web server. No test calls GitHub; `scaffold`'s acceptance run proves the real sequence.

### The github-ops spec — approved 2026-10-20

- **Approved:** `spec/SPEC-github-ops.md` as written (draft `0601f9b`), with the agent's calls: `clone` and `findTag` join the steps and `checkLogin` runs first; a new repo keeps GitHub's defaults for other settings; `watchRun` polls every 10 s, waits 2 min for the run to appear and 30 min for it to complete, and returns a failed run; an unexpected 404 or 409 is retried 3 times, 3 s apart; the exit-code table for GitHub's answers; the API version `2026-03-10`; `sleep` and process groups in the World, with SIGKILL 5 s after SIGTERM.

### Packages in place of the custom command code — settled 2026-10-20 (module `github-ops`, during the build)

- **Peter asked:** "All this logic we're building around commands and stuff. Does a package like city or the router package that we're using not provide any of this logic that we're doing? It just seems like a lot of custom stuff." The agent read "city" as citty.
- **Facts given** (`docs/research/11-packages-for-the-command-runtime.md`, probes on Bun 1.4.0): citty and the router run no commands; the router's README says it "does not own handlers, effects, output, or process lifetime"; bombshell's planned framework, Clink, is not public. No package covers the fake World, the progress steps, the redaction, the JSON-line shapes, questions mid-run or the GitHub steps. execa 10.2.0 matched the World's program runner in four hard probes, at the cost of 18 packages unless bundled and no Bun claim. incur 0.7.1 gives a command runner, JSON mode and an MCP server from one declaration, but breaks ADR-0007 and ADR-0009 and reported one failed command to an MCP client as a success.
- **Recommended and answered:** keep our code. The agent's call, with no loss: the World's `sleep` uses `setTimeout` from `node:timers/promises`, which takes the cancel signal.

### git's hook variables — settled 2026-10-20 (module `github-ops`, during the build)

- **First version** offered: git calls drop git's own list of 15 variables (`git rev-parse --local-env-vars`), or keep the whole environment. **Peter:** "this feels hacky - option 1 feels like a bad solution - option 2 also does - we should be able to handle this correctly and reliably and safely - I'll ask again if there are other established packages that can help us with this that would allow us to have significantly less custom code". A research agent started note 12; task 11 and every git or GitHub change waited.
- **Peter, next:** "this feels like it's harder than it needs to be for the Git stuff ... in Brain or the design system, the publishing ... Those repositories already do that just fine." **Agent's answer:** brain's publishing runs in GitHub Actions and stays there (the shared workflows); this module runs the one-time setup that was done by hand; the extra code comes from the chosen requirements (re-run, exit codes, JSON progress, offline tests). The agent owned turning a rare case into a design question.
- **Second question** (how to finish). Peter asked: "Is Acme Labs run inside a [git hook]?" Defect: "acmelabs must run inside a git hook" read as a rule, not as the condition for the problem. Repaired: no; a person types `acmelabs new` and `acmelabs marketplace add` in a terminal.
- **Peter, next:** could the folder be passed by flag, so a flag overrides the variable? The agent answered yes for `GIT_DIR` and `GIT_WORK_TREE` (`--git-dir`, `--work-tree`), pending the research's probe of the rest.
- **Facts given** (`docs/research/12-git-and-github-packages.md`): the flags cover two variables only; a linked worktree's commit hook also sets `GIT_INDEX_FILE`, and a `git clone` under it overwrote another repo's index; git's hook docs, git's own code, pre-commit and simple-git 4.0 clear the variables; clearing every `GIT_` variable gave the right answer in every probed case; no package cuts the GitHub code much (about 600 of 907 lines are ACMElabs's own rules).
- **Recommended and answered:** clear the `GIT_` variables for every git call that acmelabs makes. Recorded in ADR-0016.
