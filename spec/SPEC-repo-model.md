# Spec: repo-model

Module `repo-model`, layer 1 of the capability map (`spec/README.md`). It depends on no other module. Words follow `CONTEXT.md`. Status: approved by Peter on 2026-10-20.

## Objective

Give every command one source of truth for what a repo is: its repo kinds and, for a plugin repo, its hosts. Today each repo hard-codes this in its own scripts: brain's `version-sync.ts` lists five manifests, jev-gate's lists two, and each `validate.ts` lists its own validators. After this module, a repo declares its kinds and hosts once, in `acmelabs.json`, and the host table in `@acmelabs/cli` knows each host's manifests and validators.

The users are the other modules' commands (`repo-checks`, `marketplace-add`, `scaffold`, `agent-guide`), the maintainer who edits `acmelabs.json`, and the maintainer's editor.

Acceptance: see "Success criteria".

## Tech stack

- Bun 1.4.0, TypeScript, `bun:test`.
- zod 4 for the repo config schema. **Agent's call, small and reversible:** the router (ADR-0009) reads Standard Schema, which zod implements, and zod's `z.toJSONSchema` generates the editor schema that `acmelabs.json` is checked against. The command list (`command-core`) and the MCP tool schemas (`agent-guide`) need the same generation.

## The repo config

`acmelabs.json` at the repo root (interview, "Where the repo config lives"). It holds one or both repo kinds.

A Claude Code-only plugin repo, such as jev-gate after its migration:

```json
{
  "$schema": "./node_modules/@acmelabs/cli/schema/acmelabs.schema.json",
  "plugin": { "hosts": ["claude-code"] }
}
```

This repo, both kinds at once:

```json
{
  "$schema": "./packages/cli/schema/acmelabs.schema.json",
  "plugin": { "hosts": ["claude-code", "codex", "gemini-cli", "antigravity-cli"] },
  "library": { "packages": ["packages/cli", "packages/config"] }
}
```

Rules:

- At least one of `plugin` and `library` is present.
- `plugin.hosts` is a non-empty list of distinct host ids from the host table.
- `library.packages` is a non-empty list of distinct relative paths to package folders, written from the repo root with `/` between folders: not blank, not absolute, no drive prefix such as `C:`, no backslash or NUL character, and no `..` segment (Peter, 2026-10-20, so the editor schema and the command agree). A single-package library repo lists `"."`.
- No other field is allowed, so a typo fails instead of being ignored.
- **Agent's call, small and reversible:** `$schema` points into `node_modules`, so the editor check follows the installed CLI version and works offline. This repo points at its own source.

## The host table

Facts from `docs/research/01-acmelabs-repos.md`, and `agy plugin validate` run on 2026-10-20.

| Host id | Name | Manifests (path, version field) | Validators (required) |
|---|---|---|---|
| `claude-code` | Claude Code | `.claude-plugin/plugin.json` (`version`); `.claude-plugin/marketplace.json` (`plugins.0.version`) | `claude plugin validate . --strict` (yes); `claude plugin validate .claude-plugin/plugin.json --strict` (yes) |
| `codex` | Codex | `.codex-plugin/plugin.json` (`version`); `.agents/plugins/marketplace.json` (`plugins.0.version`) | none exists |
| `gemini-cli` | Gemini CLI | `gemini-extension.json` (`version`) | `gemini extensions validate .` (no: runs when `gemini` is on PATH) |
| `antigravity-cli` | Antigravity CLI | `plugin.json` (no version field) | `agy plugin validate .` (no: runs when `agy` is on PATH) |

A required validator that is not on PATH is a failure. An optional one is skipped with one line that says so, as brain's `validate.ts` does today.

The four hosts together name brain's five versioned manifests, in brain's order, so brain's later migration changes nothing.

## Interface

```ts
// packages/cli/src/repo/config.ts
export const repoConfigSchema: z.ZodType<RepoConfig>;
export type RepoConfig = {
  plugin?: { hosts: HostId[] };
  library?: { packages: string[] };
};
/** Reads and checks <root>/acmelabs.json. Throws RepoConfigError naming the file and each issue. */
export function readRepoConfig(root: string): Promise<RepoConfig>;
/** The canonical file text: two-space JSON, the $schema line first, a final newline. */
export function formatRepoConfig(config: RepoConfig, schemaPath: string): string;

// packages/cli/src/repo/hosts.ts
export type HostId = "claude-code" | "codex" | "gemini-cli" | "antigravity-cli";
export type Manifest = { host: HostId; path: string; version: string | null };
export type Validator = { host: HostId; command: readonly string[]; required: boolean };
export const hosts: Readonly<Record<HostId, Host>>;
/** Every manifest of the repo's hosts, in host-table order. Empty for a library-only repo. */
export function manifestsFor(config: RepoConfig): Manifest[];
/** Every validator of the repo's hosts, in host-table order. */
export function validatorsFor(config: RepoConfig): Validator[];
```

`RepoConfigError` carries the file path and a list of issues, each with a field path and a message, for example `plugin.hosts[1]: "claude" is not a host; the hosts are claude-code, codex, gemini-cli, antigravity-cli`. `command-core` turns it into an exit code and output.

## Commands

The module has no `acmelabs` command of its own. Its checks run inside the repo's gate:

```
bun run check          # typecheck, lint, format check, tests, version check
bun run schema         # write packages/cli/schema/acmelabs.schema.json from the zod schema
bun run schema --check # exit 1 when the file is not current; part of bun run check
```

## Project structure

This module is the first code in the repo, so it sets the layout:

```
acmelabs.json                        this repo's own repo config
package.json                         private workspace root: workspaces, scripts, devDependencies
packages/cli/                        @acmelabs/cli
  package.json
  schema/acmelabs.schema.json        generated; checked by `bun run schema --check`
  src/repo/config.ts                 the schema, readRepoConfig, formatRepoConfig
  src/repo/hosts.ts                  the host table, manifestsFor, validatorsFor
  src/repo/__tests__/config.test.ts
  src/repo/__tests__/hosts.test.ts
packages/config/                     @acmelabs/config (module config-presets)
```

The root's tooling (tsconfig, oxlint, oxfmt, changesets) comes in the plan's first task. It uses `packages/config` through the workspace before that package is on npm.

## Code style

Matches brain's scripts and DEC-001: `type` for object shapes, function declarations with helpers above their callers (Ultracite's `no-use-before-define` requires that order), a one-line doc comment per export, Bun file APIs, 100 columns, trailing commas.

```ts
/** Every manifest of the repo's hosts, in host-table order. Empty for a library-only repo. */
export function manifestsFor(config: RepoConfig): Manifest[] {
  const declared = new Set(config.plugin?.hosts);
  return hostIds
    .filter((id) => declared.has(id))
    .flatMap((id) => hosts[id].manifests.map((manifest) => ({ host: id, ...manifest })));
}
```

## Testing strategy

The module has no command, so its tests are direct calls, the way brain's `version-sync.test.ts` works: fixture repos in a temp folder, real files, no fakes. They live in `packages/cli/src/repo/__tests__/`.

- `config.test.ts`: a plugin-only, a library-only and a both-kinds config read back typed; each error case below names the file and the field; `formatRepoConfig` output reads back equal, and a second format is byte-identical.
- `hosts.test.ts`: the manifests for `claude-code` alone are jev-gate's two; for all four hosts, the versioned manifests are brain's five in brain's order; validators keep host-table order; a library-only config has no manifests and no validators.
- The schema check: the shipped `acmelabs.schema.json` equals `z.toJSONSchema(repoConfigSchema)`.

Prior-art tests: brain's `scripts/version/__tests__/version-sync.test.ts`.

## Boundaries

- **Always:** `acmelabs.json` is the only source of a repo's kinds and hosts. A missing or invalid file is an error that names the file; the module reads nothing else to guess.
- **Always:** the module reads; it writes no repo file. `scaffold` and `jev-gate-migration` write `acmelabs.json` with `formatRepoConfig`.
- **Ask first:** adding a host, changing a manifest path or version field, or changing the config's shape. Each one changes every ACMElabs repo.
- **Never:** a field the schema does not define; the schema stays strict.

## User stories

1. As a plugin repo's maintainer, I want to declare my hosts once in `acmelabs.json`, so that every command and workflow writes and checks the same manifests.
2. As a library repo's maintainer, I want to list the packages that publish, so that the release flow publishes exactly those.
3. As this repo's maintainer, I want both kinds in one file, so that both release flows run from one repo.
4. As a maintainer editing `acmelabs.json`, I want my editor to check and complete it, so that a wrong host id shows before any command runs.
5. As a command's author, I want one function that reads and checks the repo config, so that no command parses `acmelabs.json` on its own.
6. As a command's author, I want the list of manifests for a repo, so that version sync and version check need no host knowledge.
7. As a command's author, I want the list of validators for a repo, so that validate needs no host knowledge.
8. As a maintainer, I want a missing `acmelabs.json` to fail with the path it looked for, so that I know what to create.
9. As a maintainer, I want an unknown host id to fail with that id and the known ids, so that I can fix a typo.
10. As a maintainer, I want a config with neither kind to fail, so that every repo says what it releases.
11. As a maintainer, I want a misspelled field to fail, so that a setting I meant to change is not silently ignored.
12. As a Claude Code-only plugin's maintainer, I want only the Claude Code manifests named, so that version sync never looks for a file my repo lacks.
13. As brain's maintainer, I want the four hosts to name brain's five versioned manifests in brain's order, so that brain's migration changes no file.
14. As a maintainer, I want optional validators skipped with one line when their tool is missing, so that CI without Gemini CLI or Antigravity still passes.
15. As a reviewer, I want the shipped JSON schema to match the code's schema, so that the editor check and the command check never disagree.
16. As a contributor adding a host later, I want the host table in one file, so that a new host is one entry and its tests.
17. As the `scaffold` module, I want one function that writes the canonical file text, so that a new repo's `acmelabs.json` passes the same check and never churns.
18. As the `jev-gate-migration` module, I want jev-gate's config to be two lines of content, so that the migration is easy to review.

## Out of scope

- Writing or changing manifests: `repo-checks` does that with `manifestsFor`.
- Running validators: `repo-checks` does that with `validatorsFor`.
- Changesets config, workflow callers and package scripts: `scaffold` writes them.
- Detecting hosts from existing files, for example to write a first `acmelabs.json` for an old repo.

## Prior-art tests

- brain `scripts/version/__tests__/version-sync.test.ts`: fixture repos in a temp folder, write and check modes, byte-identical second write, error messages that name the file and the field.

## Success criteria

- [ ] `readRepoConfig` returns a typed config for a plugin-only, a library-only and a both-kinds `acmelabs.json`.
- [ ] Each of these fails with a `RepoConfigError` that names the file and the field: no file; invalid JSON; neither kind; an empty host list; an unknown host; a repeated host; an empty package list; a repeated package; an unknown field.
- [ ] `manifestsFor` gives jev-gate's two manifests for `claude-code`, and brain's five versioned manifests, in brain's order, for all four hosts.
- [ ] `validatorsFor` gives the table's validators in host-table order, with `required` as the table says.
- [ ] `formatRepoConfig` reads back equal, and a second run is byte-identical.
- [ ] `bun run schema --check` passes, and it fails after a change to the zod schema without a regenerated file.
- [ ] `bun run check` is green.

## Open questions

1. Does Antigravity accept a `version` field in the root `plugin.json`? brain leaves it out, so version sync leaves it out too; adding it would change brain's files. Research before `repo-checks`.
2. CI runs the optional validators only when their tool is installed. Whether the shared CI workflow installs Gemini CLI and Antigravity is for `shared-workflows`; Gemini CLI's install may need Node, which conflicts with the Bun-only rule.
