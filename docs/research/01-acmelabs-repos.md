# ACMElabs repos as they stand

What this is: the main session's own reads of the ACMElabs repos, the GitHub org and two reference projects, for the CLI spec. Researched on 2026-10-19 and 2026-10-20. Produced by the main session, with `cat`, `diff`, `gh api` and local runs.

## brain: the reference shape

Files read in full: `AGENTS.md`, `package.json`, `.changeset/README.md`, `.changeset/config.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/version/version-sync.ts`, `scripts/release/release-notes.ts`, `scripts/validate.ts`, `oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.json`, `bunfig.toml`, both test files, and `docs/decisions/DEC-001-lint-and-format.md`. The repo also has `.github/workflows/evals.yml`. Local `main` matched `origin/main` at commit `7dee2ef3`.

### Package

- Name `@acmelabs/brain`, version 0.6.0, `"private": true`, `"type": "module"`.
- devDependencies: `@changesets/changelog-github` ^1.0.1, `@changesets/cli` ^3.0.2, `@types/bun` ^1.3.14, `oxfmt` 0.68.0, `oxlint` 1.83.0, `typescript` ^5.6.0, `ultracite` 7.12.0.

| Script | Command |
|---|---|
| `typecheck` | `tsc --noEmit` |
| `lint` | `oxlint scripts oxlint.config.ts oxfmt.config.ts` |
| `format` | `oxfmt scripts oxlint.config.ts oxfmt.config.ts` |
| `format:check` | `oxfmt --check scripts oxlint.config.ts oxfmt.config.ts` |
| `check` | typecheck, lint, format:check, `bun test`, `version:sync -- --check`, then four brain-only checks |
| `test` | `bun test` |
| `version:sync` | `bun run scripts/version/version-sync.ts` |
| `validate` | `bun run scripts/validate.ts` |
| `changeset` | `changeset` |
| `version` | `changeset version && bun run version:sync` |

brain-only scripts: `sync`, `plain-talk:render`, `setup:write`, `lifecycle:check`, `question:check`, `evals:gate`.

### Release flow

`.changeset/config.json`: changelog `@changesets/changelog-github` with `repo` and `disableThanks: true`, `commit: false`, `access: "restricted"`, `baseBranch: "main"`, `privatePackages: { version: true, tag: false }`.

`ci.yml` runs on a push to main and on every pull request:

1. `actions/checkout@v5`, `oven-sh/setup-bun@v2` with `bun-version: "1.4.0"`.
2. `bun install --frozen-lockfile`.
3. typecheck, lint, format:check, `bun test`, the four brain-only checks, `version:sync -- --check`.
4. `bun add -g @anthropic-ai/claude-code`, then `bun run validate`.

`release.yml` runs on a push to main and on `workflow_dispatch`. Top-level permissions are `contents: read`. The job has `contents: write` and `pull-requests: write`, and the concurrency group `release` with no cancel.

1. Checkout with `fetch-depth: 0`, setup Bun 1.4.0, `bun install --frozen-lockfile`.
2. `version:sync -- --check`, then `bun run check`.
3. `changesets/action@v1` with `version: bun run version`, commit and title `ci: Version Packages`.
4. When `hasChangesets` is `false`: read the version from `package.json`. A version with a hyphen is a pre-release.
5. Stop when the tag `v<version>` already exists on the remote (`git ls-remote`).
6. `gh release create v<version> --target "$GITHUB_SHA"`, with notes from `scripts/release/release-notes.ts`, and `--prerelease` or `--latest`.
7. For a non-pre-release only: `git tag -f latest "$GITHUB_SHA"` and `git push -f origin refs/tags/latest`.

### Scripts

`version-sync.ts` writes `package.json`'s version into five manifests, or with `--check` exits 1 on drift:

| Path | Field |
|---|---|
| `.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | `plugins.0.version` |
| `.codex-plugin/plugin.json` | `version` |
| `.agents/plugins/marketplace.json` | `plugins.0.version` |
| `gemini-extension.json` | `version` |

`release-notes.ts` returns the text under `## <version>` (an optional `v` prefix is accepted) up to the next `## ` heading. With no section, or an empty one, it returns `Release <version>.`. It reads `CHANGELOG.md` relative to its own folder (`${import.meta.dir}/../../CHANGELOG.md`), not the working directory.

`validate.ts` runs these steps in order. The exit code is the first failure.

| Step | Command | Required |
|---|---|---|
| claude | `claude plugin validate . --strict` | yes |
| claude manifest | `claude plugin validate .claude-plugin/plugin.json --strict` | yes |
| agy | `agy plugin validate .` | no: skipped with one line when `agy` is not on PATH |

### Lint, format and tsconfig

- `oxlint.config.ts` imports `ultracite/oxlint/core` and uses `extends: [core]`. It spreads `core.ignorePatterns` and adds brain's vendored folders (`skills`, `references`, `agents`, `hooks`, `licenses`, `commands`, `.claude/commands`).
- `oxfmt.config.ts` spreads `ultracite/oxfmt`, sets `printWidth: 100` and `trailingComma: "all"`, and spreads `ultracite.ignorePatterns` plus the same folders.
- `tsconfig.json`: `target` and `module` ESNext, `moduleResolution: "bundler"`, `lib: ["ESNext"]`, `types: ["bun"]`, `strict`, `noUncheckedIndexedAccess`, `noEmit`, `skipLibCheck`, `verbatimModuleSyntax`. It includes `scripts/**/*.ts`.
- `bunfig.toml`: `[test] root = "scripts"`.

DEC-001 (decided 2026-09-19 by Peter, for every ACMElabs repo) states each deviation from Ultracite's presets:

| Where | Preset says | brain does | Reason |
|---|---|---|---|
| Oxfmt | 80 columns | 100 columns | plain scripts with long path strings; 80 wraps every template literal |
| Oxfmt | ES5 trailing commas | trailing commas everywhere | one convention across ACMElabs repos |
| Oxlint | `func-style` expression | off | declarations hoist, so a file reads top-down |
| Oxlint | `sort-keys` | off | object keys are ordered by meaning, not alphabet |
| Oxlint | `no-await-in-loop` | off | the sync is sequential by design: ordered writes, and a collision check that finishes before the first write |
| Oxlint | `consistent-type-definitions` interface | `type` | the spec's code style uses `type` |

### Tests (prior art)

- `scripts/version/__tests__/version-sync.test.ts`: real files in a `mkdtemp` folder. It checks the five manifest paths, a write into nested and flat fields, check mode with no write, a byte-identical second write with a final newline, and errors that name the file and field.
- `scripts/release/__tests__/release-notes.test.ts`: direct calls to the pure function. It checks a middle section, the last section, the fallback, an empty changelog and a `v`-prefixed heading.

### Agent files

brain has no root `CLAUDE.md`. Its `.claude/CLAUDE.md` holds one line, `@../AGENTS.md`. jev-gate has the same file.

## jev-gate against brain

jev-gate is `@acmelabs/jev-gate` 0.2.0, `"private": true`. Its `check` runs typecheck, lint, format:check, `bun test` and `version:sync -- --check`. It adds a `report` script. Local `main` matched `origin/main`.

| File | Difference from brain |
|---|---|
| `release.yml` | Comments only: it names brain as its source, and says "both manifests in .claude-plugin/". |
| `ci.yml` | It lacks brain's four brain-only checks. |
| `version-sync.ts` | Two manifests: `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. |
| `release-notes.ts` | Identical. |
| `validate.ts` | No `agy` step. The comment says jev-gate is a Claude Code plugin only. |
| `oxlint.config.ts` | Different comments, no vendored ignore list, and a different reason for `no-await-in-loop`. |
| `oxfmt.config.ts` | Different comments, and no `ignorePatterns`. |
| `tsconfig.json`, `bunfig.toml` | Identical. |
| `.changeset/config.json` | Only the `repo` name differs. |

## ask-user-question

`ask-user-question` 0.1.6, `"private": true`. It differs more than jev-gate:

- Scripts: `typecheck`, `changeset`, `version` (`changeset version && bun run sync-version`), `sync-version`, and `check` (`validate-skill.ts && typecheck && sync-version --check && intent validate`).
- devDependencies include `@tanstack/intent` 0.4.0 and `yaml` 2.9.0. No oxlint and no oxfmt.
- Workflows: `release.yml` only.
- Scripts folder: `probe-trigger.ts`, `release-notes.ts`, `sync-version.ts`, `validate-skill.ts`. It also has a `Makefile`.

## marketplace

The README states these conventions:

- Each plugin lives in its own repo.
- One registry file per host: `.claude-plugin/marketplace.json` for Claude Code and `.agents/plugins/marketplace.json` for Codex.
- An entry's source is the full HTTPS URL with `ref: latest`. The `owner/repo` shorthand resolves to SSH and fails on a machine with no key.
- No entry carries a version string. The `latest` tag decides what installs.
- The "Plugins" table has one row per plugin.

The Claude Code file lists ask-user-question, brain and jev-gate. The Codex file lists ask-user-question and brain. The README has no "Add a plugin" section. `claude plugin validate . --strict` passed on 2026-10-19, with Claude Code 2.1.304.

## The GitHub org

acmelabs-15 is an organization on the `team` plan. Highlights of `gh repo list`:

| Visibility | Repos |
|---|---|
| Public | brain, jev-gate, marketplace, design-system, ask-user-question, plugin-kit, sessions, skills, narf, package, agx, .github |
| Private | .claude-alt, .gemini, .claude, code-review, asking-users-questions, skill-creator, code-simplifier, labs, pinky, discussions |

`acmelabs-15/cli` did not exist on 2026-10-19.

`acmelabs-15/.github` holds `.github/workflows/bugbot.yml`, `workflow-templates/bugbot.json`, `workflow-templates/bugbot.yml` and `profile/README.md`. Its last commits are from 2026-03-07 and 2026-03-08. It has no tags.

### Branch protection

| Repo | Classic protection | Rulesets |
|---|---|---|
| brain | none | "Protect main" (id 25457893), created 2026-10-19T23:50:57-07:00, enforcement `active`, target the default branch (`~DEFAULT_BRANCH`), rules `non_fast_forward` and `deletion`, no bypass actors |
| jev-gate | none | none |

"Protect main" blocks force-push and deletion. It does not require pull requests or status checks.

### Actions setting

Both brain and jev-gate return `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}`. The org-level read failed with HTTP 403: it needs the `admin:org` scope. The `gh` account is `loriensleafs`, with scopes `admin:public_key`, `gist`, `read:org`, `repo` and `workflow`.

## Hosts and validators

Local tools: Bun 1.4.0, Claude Code 2.1.304, and `codex`, `gemini` and `agy` on PATH.

| Host | Versioned manifests in brain | Validator on this machine |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | `claude plugin validate --strict` |
| Codex | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` | none: `codex plugin` has `add`, `list`, `marketplace`, `remove` only |
| Gemini CLI | `gemini-extension.json` | `gemini extensions validate <path>`; brain does not run it today |
| Antigravity CLI | reads the root `plugin.json`, which has no version | `agy plugin validate [path]` |

brain's root `plugin.json` holds only `name` and `description`.

## design-system and npm

- Workspace `@acmelabs/design-system-workspace`, `"private": true`. Packages: `@acmelabs/design-system`, `@acmelabs/design-system-react`, `@acmelabs/design-system-mcp`, `@acmelabs/design-system-devtools`. No `.changeset` folder.
- Workflows: `pages.yml`, `publish-package.yml`, `quality.yml`.
- `publish-package.yml` pins actions by commit SHA with a version comment (checkout v7.0.1, setup-bun v2.2.0) and uses `bun-version: 1.4.2`. The publish job has `id-token: write` and the environment `publish-package`, and it runs only when `vars.ACME_RELEASE_ENABLED == 'true'`.
- `notes/alignment/release-0.3.0.md` says: npm has core 0.2.0; the three companion names return 404; npm's trusted-publisher CLI requires an existing package, so a new name needs an authenticated first publish; the npm password confirmation was pending; "Do not use the previously exposed npm credential".

## plugin-kit

`plugin-creator` (`skills/plugin-creator/SKILL.md`) runs eight phases: Purpose, Where it ships, Components, Design (gate), Scaffold, Implement, Validate (loop), Verify (loop). Phase 5, Scaffold, makes the folders by hand with `mkdir -p`. The repo is public. Its last commit is from 2026-09-01.

## Baseline before any migration

- jev-gate: `bun run check` passed: 82 tests, 0 failures, 167 `expect()` calls across 9 files, and every manifest matched `package.json`.
- marketplace: `claude plugin validate . --strict` passed.

## brain and agent-skills

brain's README says brain carries Addy Osmani's agent-skills unchanged. `skills/` holds 25 agent-skills, 3 of mattpocock/skills, ask-user-question and brain's own. Eight skills keep agent-skills' names; brain seeded them from addy's text and owns them. No brain page says what happens when both plugins are installed. In the spec session both were installed, and each lifecycle skill showed twice, for example `agent-skills:spec-driven-development` and `brain:spec-driven-development`.

On this machine, `agent-skills@addy-agent-skills` 0.6.13 is installed at user scope. The known marketplaces include `acmelabs` (GitHub `acmelabs-15/marketplace`) and `addy-agent-skills` (GitHub `addyosmani/agent-skills`).

## Project-scope plugins

- `claude plugin install` takes `-s, --scope <scope>`: `user`, `project` or `local` (default `user`).
- A project enables plugins with two keys in `.claude/settings.json`: `extraKnownMarketplaces` and `enabledPlugins`. Two projects on this machine show the shape: `~/Dev/ai-agents/.github/copilot/settings.json` and `~/Dev/awaken-the-slumberer/.claude/settings.json`.

## awaken-the-slumberer: the precedent

- `.claude/settings.json` declares the marketplaces `unity-agent-plugin`, `addy-agent-skills` and `acmelabs`, each with a GitHub source, and enables `unity@unity-agent-plugin`, `agent-skills@addy-agent-skills` and `brain@acmelabs`.
- `CLAUDE.md` imports `AGENTS.md`. agent-skills drives each phase (`/agent-skills:spec`, `:plan`, `:build`, `:test`, `:review`, `:ship`). brain supplies the skills agent-skills lacks, each at its trigger. It says: "When both plugins carry a skill with the same name, run the agent-skills version."
- Layout: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `docs/STATUS.md`, `docs/design/kickoff-brief.md`, `docs/design/phase1-interview.md`, `docs/decisions/NNNN-short-title.md`, `docs/research/` with a README, `tasks/plan.md` and `tasks/todo.md`.
