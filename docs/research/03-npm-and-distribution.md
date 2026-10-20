# npm names and distribution

What this is: research on the npm names, local npm auth, `bun create`, installing from GitHub, single-file binaries, publishing from GitHub Actions, and a `.ts` bin. Researched on 2026-10-20. Produced by a research agent of the spec session, read-only. It used curl against registry.npmjs.org and local Bun 1.4.0 tests with a separate install cache, so the global Bun cache stayed unchanged.

One premise of the brief is wrong: this is not the first ACMElabs publish. `@acmelabs/design-system` is already public on npm and publishes through trusted publishing.

## 1. npm names (checked 2026-10-20)

| Name | Status | Evidence |
|---|---|---|
| scope `@acmelabs` | Taken. It is an npm **org** with 1 package. | `/-/org/acmelabs/package` returns `{"@acmelabs/design-system":"write"}`. Maintainer is `loriensleafs`, which is Peter (the registry email matches his). 0.1.0 was published by hand. 0.1.1 and 0.2.0 came from the "GitHub Actions" trusted publisher with SLSA provenance, repo acmelabs-15/design-system. |
| scope `@acmelabz` | Taken. It is an org with 0 packages. | `/-/org/acmelabz/package` returns `{}` with HTTP 200. A free scope returns 404 "Scope not found". Owner is not public: UNVERIFIED. |
| `acmelabs` (unscoped) | Free | 404 |
| `create-acmelabs` | Free | 404 |
| `@acmelabs/cli` | Free | 404. Publishing it needs write access to the `@acmelabs` org. |
| user/org name `acmelabs` | Taken by the org | `/-/org/acmelabs/user` returns `{}`, the same as the org `babel`. A user scope returns `{"<name>":"owner"}` (checked for `loriensleafs` and `sindresorhus`). This is an inference from that pattern. |

- `search?text=scope:acmelabs` returns 0 even though the org has a package. That endpoint cannot show that a name is free.
- The main session also checked `@acmelabs/config` on 2026-10-20: 404, free.

## 2. Local auth

- `bun pm whoami` returns `401 Unauthorized: https://registry.npmjs.org/-/whoami`.
- `~/.npmrc` has an auth line. `~/.bunfig.toml` does not exist. No `NPM_TOKEN`, `NPM_CONFIG_TOKEN` or `NODE_AUTH_TOKEN` is set in the environment.
- npm rejects the stored credential. The cause is UNVERIFIED. One possibility: npm revoked all classic tokens on 2025-12-09 (github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available).

## 3. `bun create <x>` (https://bun.com/docs/runtime/templating/create)

- Bun looks for a local template first: `$HOME/.bun-create/<x>` or `./.bun-create/<x>`. `BUN_CREATE_DIR` changes the global path.
- If there is none, `bun create <x>` is the same as `bunx create-<x>` from npm. So `bun create acmelabs` would run `create-acmelabs`.
- `bun create <user>/<repo>` or `github.com/<user>/<repo>` downloads the GitHub tarball, runs `git init`, then runs `bun install`.
- Exceptions: `elysia`, `elysia-buchta` and `stric` come from `@bun-examples`. `react` and `next` only print a message.

## 4. Installing and running from GitHub

- `bunx github:owner/repo` works since Bun 1.0.5 (oven-sh/bun#5974, PR #6042). Bun's own test "should work for github repository" in test/cli/install/bunx.test.ts covers it.
  - Caveat: bunx takes the bin name from the **repo name**. A repo `acmelabs-15/cli` gives bin `cli`.
  - So name the repo `acmelabs`, or use `bunx -p github:… acmelabs`. The `-p` form is UNVERIFIED: no test covers it.
- Dependencies like `github:…#v0.1.0` and `git+https:` are supported (https://bun.com/docs/pm/cli/add#git-dependencies).
- Tested on Bun 1.4.0 with a local git repo and a separate install cache:
  - Bun linked the bin: `node_modules/.bin/acmelabs -> src/cli.ts`.
  - Bun made the file executable.
  - A package.json script ran it under Bun.
- `prepare` runs only if the consumer lists the package in `trustedDependencies`. Bun does not install devDependencies first (same docs page). The test showed "Blocked 1 postinstall".
- Result: a TS-source bin works straight from GitHub under Bun. Ship runnable TS, with no build step.
- `#semver:^1.0.0` does **not** work. Issue #5870 is still open, and a test on 1.4.0 failed with `no commit matching "semver:^0.1.0"`. Pin exact tags.

## 5. `bun build --compile` (https://bun.com/docs/bundler/executables)

- Targets: `bun-{linux,windows,darwin}-{x64,arm64}` and `bun-linux-{x64,arm64}-musl`.
- Size: a hello-world built with 1.4.0 on darwin-arm64 is 63.9 MB. Compressed it is 25.9 MB with gzip and 17.2 MB with xz.
- GitHub Releases: one job can cross-compile all targets.
- macOS signing and quarantine:
  - The output has an ad-hoc signature (checked with `codesign -dv`).
  - A browser download gets `com.apple.quarantine`. Gatekeeper then blocks the binary unless it has a Developer ID signature and is notarized.
  - `curl` and `gh release download` do not set quarantine (github.com/phenixblue/k8shark/issues/316).
  - The Bun docs show `codesign` with a JIT entitlements plist.
  - Bun 1.3.12 wrote broken signatures, and macOS killed the binaries on launch. PR #29272 fixed this in 1.3.13.
  - A darwin binary cross-compiled from Linux on 1.4.0: UNVERIFIED.

## 6. Publishing from GitHub Actions

- `bun publish` has **no OIDC and no provenance**.
  - Its docs say `--provenance` is an error (https://bun.com/docs/pm/cli/publish).
  - Issue #22423 is open (reopened 2026-07-04). PR #29374 was closed without a merge.
  - The 1.4.0 `--help` lists neither feature. `bun publish` reads `NPM_CONFIG_TOKEN`.
- npm trusted publishing (https://docs.npmjs.com/trusted-publishers):
  - Needs npm ≥ 11.5.1, Node ≥ 22.14.0, GitHub-hosted runners and `id-token: write`.
  - `repository.url` in package.json must match the repo exactly.
  - Provenance is automatic when both the repo and the package are public.
- The package must exist before you can add a trusted publisher. The npm-trust docs say "Package must exist", and npm/cli#8544 is still open. design-system did exactly this: 0.1.0 by hand, then OIDC.
- New rules:
  - Trusted publishers created after 2026-09-03 allow only `npm stage publish` by default. To publish directly, also allow `npm publish`.
  - A new trusted publisher must publish within 2 days, or it expires.
- Changesets v3 (`@changesets/cli` 3.0.3): `getPublishTool.ts` picks pnpm, then yarn-berry, else **npm**. So a Bun repo publishes with `npm publish`, and OIDC works. changesets/action documents `id-token: write`.
- `NPM_TOKEN` is not needed after the first publish.
  - Write tokens last at most 90 days.
  - Direct publishing with bypass-2FA tokens ends in January 2027 (docs.npmjs.com/about-access-tokens).
- A working template already exists: acmelabs-15/design-system `.github/workflows/publish-package.yml`.
  - It uses Bun for install, build and test.
  - Then it runs `setup-node` with Node 24 and `npm publish --access public --provenance --ignore-scripts`.
  - Node runs only in CI. The published package does not ship it.

## 7. A `.ts` bin with `#!/usr/bin/env bun`

- Under Bun it works. Tested with an install from a packed tarball and from git: Bun linked the bin and it ran. bunx follows the shebang, and a bun shebang makes it run under Bun (https://bun.com/docs/pm/bunx).
- With npx, npm links the bin and the shebang calls `bun`. It works only if Bun is on PATH. Otherwise the result is `env: bun: No such file or directory`.
- `node …/cli.ts` fails. Node does not strip types for files under `node_modules` (https://nodejs.org/api/typescript.html). PR nodejs/node#63853 would change this and is still open.
- npx on Windows with a bun shebang: UNVERIFIED.
