# npm tools under Bun: the npm CLI, npm's libraries and Bun's own npm commands

What this is: research for the `npm-ops` module. The module gives later commands the npm steps of a new library repo: registry reads, web login, the org (scope) check, a stage publish that creates the package with the placeholder version, and the trusted publisher. For GitHub, ADR-0014 runs `gh api`, so acmelabs never holds a token. This note collects the facts for the same choice on npm: run a tool that holds the npm login, or call the registry with fetch and hold the token in acmelabs. It decides nothing. Researched on 2026-10-20 by a research agent, with probes, the installed npm 12.2.1 source, `gh api` reads of public source, the npm registry, and Exa.

Probe machine: macOS (Darwin 25.6.0), arm64, Bun 1.4.0 (`34cbb9a40`), gh 2.98.0. The latest Bun on npm is 1.4.3 (2026-10-10); no probe ran on it. Node 24.20.0 is installed at `/opt/homebrew/bin/node`; it ran once, as a control (section 2.3). Probes ran on 2026-10-20 (PDT); npm's log file names show 2026-10-21 (UTC).

How the probes ran:

- Every npm and bun command ran as `env -i PATH=$HOME/.bun/bin:/usr/bin:/bin HOME=<temp home> NPM_CONFIG_USERCONFIG=<empty file> ...`. Inside it, `which node` exits 1. No call read `~/.npmrc`, so no token was sent.
- No call logged in, published, staged, approved, or wrote a trust config. Publish and stage publish ran only with `--dry-run`. `trust github` ran only with `--dry-run`.
- Each library was installed alone, with `bun add --ignore-scripts --exact`, into its own new folder. Package counts come from Bun's install line, and sizes from `du -sk node_modules`. The probe scripts sat in a separate folder (`npm-tools/probes/` in the session scratchpad). Both are temporary; this note keeps their results.
- About 20 GETs went to registry.npmjs.org, each a second or more apart. None got a 429.

Words in this note:

- **fake registry**: a `Bun.serve` server on 127.0.0.1 that answers like the registry, with an answer picked by the package name (`probes/fake-registry.ts`). It let the probes see npm's error output for 401, OTP, 404, 409, 429 and 500 without a request to npm. Its token was the string `fake-probe-token`.
- **web 2FA**: npm's second factor through the browser. A request gets 401 with `authUrl` and `doneUrl`; the caller polls `doneUrl` for the one-time password, then retries with the `npm-otp` header (note 04, section 3).

## Summary

**The npm CLI under Bun.** npm 12.2.1 runs under Bun 1.4.0 with no Node on PATH, through `bunx npm@12.2.1` (section 1).

- Verified: `--version`, every help text, `whoami`, `trust list`, `stage list`, `publish --dry-run`, `stage publish --dry-run`, `trust github --dry-run`, and all their error paths. npm reports `using node@v26.3.0` under Bun.
- Not run (the research rules forbid it): `npm login`, a real stage publish, a real `npm trust github`. From the source, they use the same transport (npm-registry-fetch) that the probes ran under Bun for GET and for POST. Status: UNVERIFIED on a maintainer's machine.
- In CI, npm under Bun publishes today: `@acmelabs/design-system` 0.3.2 came from npm 12.0.2 run by Bun 1.4.2, with a trusted publisher and SLSA provenance (section 6.4).
- Time: the first run took 5.25 s (download of 17 MB). Later runs of `--version` took 0.04 to 0.12 s; `whoami` took 0.12 to 0.31 s.

**No terminal.** Without a TTY, `npm login` prints the login URL and polls. It does not prompt and does not open a browser. Web 2FA does not run: npm ends with `EOTP` and, with `--json`, gives `authUrl` and `doneUrl`. `npm stage publish` needs no 2FA at all. `npm trust github` needs `--yes` (section 1.4).

**Exit codes.** Every failure probed exits 1. The `--json` output tells them apart by `error.code`: `ENEEDAUTH`, `E401`, `EOTP`, `E403`, `E404`, `E409`, `E429`, `E500`, `ECONNREFUSED`, `ENOTFOUND`, `EUSAGE`, `EUNKNOWNCONFIG`. npm's own publish checks give no code at all (section 2).

**Two npm 12 quirks a caller must handle (section 1.3):**

- For the `npm trust` subcommands, a global flag before the command, or a global flag with its value as a separate word after the subcommand, breaks the arguments (`EUSAGE`). The `--flag=value` form after the subcommand works. `npm stage publish` is not affected. npm/cli PR #9295 fixes it; it is an open draft.
- `npm trust list --json` prints one JSON object per trusted publisher, separated by blank lines, and nothing for none. It is not one JSON document.

**Where the login lives.** npm writes `//registry.npmjs.org/:_authToken=<token>` to the user npmrc and sets mode 0600. npm 12 has no keychain. `NPM_CONFIG_USERCONFIG` or `--userconfig` chooses the file, and npmrc values expand `${VAR}`. Bun 1.4.0 reads `$HOME/.npmrc`, the project `.npmrc` and `NPM_CONFIG_TOKEN`, but ignores `NPM_CONFIG_USERCONFIG`; Bun's docs say otherwise because the fix merged after 1.4.3 (section 3).

**npm's libraries.** npm-registry-fetch 20.0.1, npm-profile 13.0.1, libnpmpublish 12.0.1 and libnpmaccess 11.0.0 load under Bun 1.4.0. libnpmpublish covers the stage publish (`stage: true`). No library covers the trusted publisher or the stage approval: the npm CLI calls npm-registry-fetch directly for them. Each library brings 46 to 71 packages and 10 to 12 MB (section 4).

**Others.** changesets runs the npm CLI and holds nothing. Yarn Berry and pnpm 12 run web login themselves and keep the token in their own config files. design-system runs a pinned npm under Bun with empty npmrc files. fledgling runs `npm trust` with the terminal attached (section 6).

## 1. The npm CLI under Bun with no Node

### 1.1 Versions (registry, 2026-10-20)

| Tag | Version | Published |
|---|---|---|
| `latest` | 12.2.0 | 2026-09-30 |
| `next-12` | 12.2.1, the newest 12.x | 2026-10-15 |

- Source: `curl https://registry.npmjs.org/-/package/npm/dist-tags` and the `time` field of `https://registry.npmjs.org/npm`.
- npm 12.2.1: `engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`; 68 dependencies, all bundled; 12.4 MB unpacked, 1,942 files.
- npm/cli's default branch is `latest`. Its last commit is `ae98c62586` "chore: release 12.2.1" (2026-10-15).

### 1.2 Probes: `bunx npm@12.2.1` under `env -i`

| Command | Exit | Result |
|---|---|---|
| `bunx npm@12.2.1 --version`, cold (empty temp HOME) | 0 | `12.2.1`; 5.25 s; "Resolved, downloaded and extracted [579]" |
| the same, warm, 7 runs | 0 | 0.04 to 0.12 s |
| `bunx npm@12.2.0 --version`, cold for 12.2.0, Bun cache partly warm | 0 | 1.47 s |
| `whoami`, warm, 5 runs | 1 | 0.12, 0.13, 0.14, 0.20, 0.31 s |
| `login --help`, `stage --help`, `stage <sub> --help` (6), `trust --help`, `trust github|list|revoke --help`, `publish --help`, `whoami --help` | 0 | Help texts (section 1.5) |

- The npm debug log shows `verbose cli /Users/peterkloss/.bun/bin/bun .../node_modules/.bin/npm`, `info using npm@12.2.1` and `info using node@v26.3.0`. Bun 1.4.0 reports Node v26.3.0, so npm's engines check passes.
- With `env -i`, `TMPDIR` is unset, so bunx installed npm in `/private/tmp/bunx-501-npm@12.2.1` (17 MB). With `TMPDIR` set, bunx uses `$TMPDIR/bunx-<uid>-<package>@<version>` (one such folder exists on this machine). The Bun install cache in the temp HOME grew to 45 MB.
- `bunx` installs npm as 1 top-level package with 182 bundled packages inside it.
- npm read these config files, in order: `<bunx folder>/node_modules/npm/npmrc` (built in), `<cwd>/.npmrc` (project), the `NPM_CONFIG_USERCONFIG` file (user), `/Users/peterkloss/.bun/etc/npmrc` (global: npm derives the prefix from Bun's path).
- Whether a warm `bunx` run checks the registry: UNVERIFIED.

### 1.3 Two argument quirks of npm 12 (probes and source)

**(a) Global flags and subcommands.** npm 12 parses the flags of a subcommand in `BaseCommand.flags()` (`lib/base-cmd.js`, lines 281–326). It skips a fixed `2 + depth` words of argv. A global flag before the command shifts that offset. A global flag after the subcommand is parsed against the subcommand's own definitions only, so a separate value word becomes a positional.

| Command line (npm 12.2.1 under Bun) | Exit | Result |
|---|---|---|
| `npm --userconfig <file> trust list @acmelabs/design-system` | 1 | `EUSAGE` "Unknown positional arguments: list, @acmelabs/design-system" |
| `npm --userconfig=<file> trust list @acmelabs/design-system` | 1 | `EUSAGE` "Unknown positional argument: @acmelabs/design-system" |
| `npm --loglevel=http trust list @acmelabs/design-system` | 1 | `EUSAGE`, as above |
| `npm trust list @acmelabs/design-system --userconfig <file>` | 1 | `EUSAGE` "Unknown positional argument: <file>" |
| `npm trust github ... --dry-run --json --loglevel http` | 1 | `EUSAGE` "Unknown positional argument: http" |
| `npm trust list ... --otp 123456` | 1 | `EUSAGE` "Unknown positional argument: 123456" |
| `npm trust list @acmelabs/design-system --loglevel=http` | 1 | Reached the registry: `E401` |
| `npm trust github ... --dry-run --json --loglevel=http --userconfig=<file>` | 0 | The planned config as JSON |
| `npm trust list @probe/ok --otp=123456` (fake registry) | 0 | The request carried `npm-otp: 123456` |

- The same `EUSAGE` came from Node 24.20.0 running the same npm files, and from npm 12.2.0 under Bun. It is npm's behaviour, not Bun's.
- Only commands with `static definitions` use this parser. In npm 12.2.1 they are the five `trust` subcommands and `completion` (a search of `lib/` for `static definitions`). `lib/npm.js` line 297 picks the parser by `Command.definitions`.
- `publish`, `stage publish`, `stage list` and `whoami` use `static params` and the global parser. Probes: `npm --loglevel=http stage publish --dry-run` and `npm stage publish --dry-run --tag next` both exited 0.
- `NPM_CONFIG_USERCONFIG` in the environment avoids the flag. The debug log confirmed that npm loaded the empty file from the variable.
- npm/cli PR #9295 "fix: dynamically locate command path in argv for flags() offset" describes this bug ("`npm --registry http://... trust list`"). It is a draft, opened 2026-05-02, last updated 2026-05-04. https://github.com/npm/cli/pull/9295
- npm 12 also turns an unknown CLI flag into an error: `npm whoami --bogus-flag --json` exits 1 with `EUNKNOWNCONFIG` (npm/cli commit 979518d, "feat!: error on unknown configs, flags, and abbreviations").

**(b) A prerelease version needs `--tag`.** `publish.js` lines 133–138 throw "You must specify a tag using --tag when publishing a prerelease version." when the version has a prerelease part and no tag is set. `--force` or `publishConfig.tag` skips the check.

| Command (scratch package `@acmelabs-probe/y`, version `0.0.0-stage`) | Exit | Result |
|---|---|---|
| `npm stage publish --dry-run --json` | 1 | `{"error":{"summary":"You must specify a tag ...","detail":""}}`: no `code` key |
| `npm stage publish --dry-run --tag=stage` | 0 | `+ @acmelabs-probe/y@0.0.0-stage (staged)`; "Staging to https://registry.npmjs.org/ with tag stage and public access (dry-run)" |
| `npm publish --dry-run` with `0.0.0-stage` | 1 | The same error |

The glossary's placeholder version, `0.0.0-stage`, is a prerelease. Whether the registry makes `0.0.0-stage` itself from any staged version, or the staged version must be `0.0.0-stage`: UNVERIFIED here (see note 04, section 4, and note 13).

### 1.4 What npm does with no terminal

From the npm 12.2.1 source (`lib/utils/auth.js`, `lib/utils/open-url.js`, npm-profile 13.0.1 `lib/index.js`), read 2026-10-20. Not run.

**Web login (`npm login`, `auth-type=web`, the default):**

1. `login.js` calls `auth.login`, which calls npm-profile's `loginWeb(createOpener(npm, 'Login at'), opts)`.
2. npm-profile sends `POST /-/v1/login`. A 4xx or 500 answer becomes `ENYI` ("Web login not supported"); npm then falls back to a username and password prompt.
3. With the `loginUrl`, npm-profile runs the opener and the poll of `doneUrl` at the same time (`webAuthOpener`, `Promise.all`).
4. The opener (`openUrlPrompt`) first prints `Login at:\n<url>` to stdout, always.
5. If stdin or stdout is not a TTY, or `browser=false`, the opener returns there. No prompt, no browser.
6. With a TTY, it asks "Press ENTER to open in the browser...", then opens the browser (section 7.1).
7. The poll (`webAuthCheckLogin`) GETs `doneUrl`. A 202 waits `retry-after` seconds; a 200 with `token` ends the login. It has no overall time limit. A 202 with no `retry-after` polls again at once.
8. `login.js` writes the token to the user npmrc (section 3).

So under Bun, `npm login` reaches the printed URL by the same path as the probed requests: npm-registry-fetch POST, then output. UNVERIFIED by a run.

**`--json` hides the login URL.** With `--json`, `outputMsg` calls `output.buffer({ title, url })` instead of printing. `display.js` writes buffered items only at `npm.finish()`, when the process ends. So `npm login --json` would print the URL only after the login has finished. From source; not run.

**Web 2FA on later calls (`otplease`, `auth.js` lines 6–33):**

- If stdin or stdout is not a TTY, `otplease` throws the error at once. An `EOTP` with `authUrl` and `doneUrl` then ends the command (section 2).
- With a TTY, a web OTP opens `authUrl` through the same opener ("Authenticate your account at"), polls `doneUrl`, and retries with the token as `otp`.
- With a TTY and a classic OTP (`EOTP` with no URLs, or `E401` with "one-time pass"), npm prompts "Enter OTP:".
- `npm trust github|gitlab|circleci|list|revoke`, `npm stage approve|reject` and `npm publish` run through `otplease`. `npm stage publish` does not: "Stage intentionally bypasses otplease — 2FA is deferred to approve/reject" (`publish.js` line 207).
- A caller without a TTY can rerun the command with `--otp=<code>`. With `--otp`, npm sends `npm-auth-type: legacy` (fake registry probe; `auth-type` definition: "if an `otp` config is given, this value will always be set to `legacy`").

**The `trust github` prompt.** Without `--yes`, `confirmOperation` reads "Do you want to proceed? (y/N)" from stdin, default `n`. `--yes` skips it; `--no-yes` cancels ("User cancelled operation").

### 1.5 `--json` and what each command prints

| Command | `--json` | What stdout holds (probe or source) |
|---|---|---|
| `stage publish` | Not in its help, but works | `{"<name>": {id, name, version, size, unpackedSize, shasum, integrity, filename, files, entryCount, bundled}}` (dry-run probe). After a real stage publish, the object also holds `stageId` (`publish.js` lines 219–226; source only). Without `--json`: `+ <name>@<version> (staged with id <stageId>)` |
| `publish` | Not in its help, but works | The same object, without `stageId` (dry-run probe) |
| `trust github` | Yes | Dry run: `{"package", "file", "repository", "permissions": ["createPackage", "createStagedPackage"]}` (probe). A real run prints that object, then one more object per created config (`trust-cmd.js` lines 233–243, `logOptions`; source only), so stdout holds two or more JSON documents |
| `trust list` | Yes | One pretty-printed object per config, `{id, type, file, repository, permissions}`, separated by blank lines; nothing for zero configs (fake registry probe). Not one JSON document |
| `trust revoke` | No | — |
| `stage list` | Yes | One array of items (`stage/list.js`); it pages `/-/stage?page=&perPage=100` |
| `stage view`, `stage download` | Yes | Per their help |
| `stage approve`, `stage reject` | No | Text: "Staged package <id> approved and published successfully." |
| `whoami` | Yes | `"probe-user"`, a JSON string (fake registry probe) |

- On failure with `--json`, stdout holds `{"error": {"code", "summary", "detail"}}`, plus `authUrl` and `doneUrl` for a web OTP (`output-error.js` `jsonError`). stderr still gets the `npm error` lines.
- `trust-cmd.js` `dialogue` text ("Establishing trust between ...") goes to stdout without `--json` and is dropped with it.
- The text form of `trust github --dry-run` was, on 2026-10-20: three dialogue lines, then `package:`, `file:`, `repository:`, `permissions: publish`, then the npm, workflow and repository URLs.

## 2. Exit codes and error output

### 2.1 How npm sets the exit code (source)

- `lib/utils/error-message.js` `getError` (lines 383–448): `exitCode = getExitCodeFromError(err) || 1`. `getExitCodeFromError` returns `err.errno` or `err.code` only when it is a number.
- npm-registry-fetch's HTTP errors have string codes: `E<status>`, `EOTP` (`HttpErrorAuthOTP`, a 401 whose `www-authenticate` holds `otp`, or whose body holds "one-time pass"), `EAUTHIP` (`ipaddress`). minipass-fetch's network errors carry the code as a string `errno` too (probe: `errno: 'ECONNREFUSED'`, type string). So both end with exit 1.
- `lib/cli/exit-handler.js` exits with `err.exitCode ?? process.exitCode ?? 1`.
- Errors without a code get one only if the message starts with `E[A-Z]+` (`getError` line 428). npm's publish pre-checks ("You must specify a tag ...", "You cannot publish over the previously published versions: ...", "Cannot implicitly apply the "latest" tag ...") start otherwise, so their JSON has no `code` key (probe in 1.3).
- Shell-out commands (`run`, `exec`) pass the child's exit code through. None of the npm-ops commands is one.

### 2.2 Probes

"Real" is registry.npmjs.org with no token; "fake" is the fake registry with a fake token. Each row also ran with `--json`; the code column is `error.code` from stdout.

| Case | How | Exit | `error.code` | Text (stderr, `npm error` lines) |
|---|---|---|---|---|
| No login | real, `whoami` | 1 | `ENEEDAUTH` | "This command requires you to be logged in." / "You need to authorize this machine using `npm login`". No request was sent (`get-identity.js` line 22) |
| No login, trust read | real, `trust list @acmelabs/design-system` | 1 | `E401` | "401 Unauthorized - GET .../-/package/@acmelabs%2fdesign-system/trust - Bearer token authorization is required" |
| No login, stage read | real, `stage list @acmelabs/design-system` | 1 | `E401` | "401 Unauthorized - GET .../-/stage?page=0&perPage=100&package=... - Unauthorized" |
| Bad token | fake, 401 with `www-authenticate: Bearer` | 1 | `E401` | "Unable to authenticate, your authentication token seems to be invalid." / "npm login" |
| 401 without `www-authenticate` | fake | 1 | `E401` | The raw "401 Unauthorized - GET ..." line |
| Web OTP needed | fake, 401, `www-authenticate: OTP`, body `{authUrl, doneUrl}` | 1 | `EOTP` | "This operation requires a one-time password." plus both URLs. JSON adds `authUrl` and `doneUrl` |
| Classic OTP needed | fake, 401, `www-authenticate: OTP` | 1 | `EOTP` | "... one-time password from your authenticator." / "--otp=<code>" |
| Forbidden | fake, 403 | 1 | `E403` | "403 Forbidden - GET ..." plus a hint about a "security policy" |
| Not found | fake, 404 | 1 | `E404` | "404 Not Found - GET ... - Not found" |
| Conflict | fake, 409 | 1 | `E409` | "409 Conflict - GET ... - Conflict" |
| Rate limit | fake, 429, `--fetch-retries=0` | 1 | `E429` | 0.23 s |
| Rate limit, default retries | fake, 429 | 1 | `E429` | **70.17 s**, 3 requests: npm retried twice (make-fetch-happen's defaults) |
| Server error | fake, 500, `--fetch-retries=0` | 1 | `E500` | 0.11 s |
| Connection refused | `--registry=http://127.0.0.1:1/` | 1 | `ECONNREFUSED` | A FetchError with its stack and a proxy hint |
| DNS failure | `--registry=http://no-such-host.invalid/` | 1 | `ENOTFOUND` | "This is a problem related to network connectivity." |
| Bad arguments | section 1.3 | 1 | `EUSAGE` | The usage text |
| Unknown flag | `whoami --bogus-flag` | 1 | `EUNKNOWNCONFIG` | "Unknown cli flag: - --bogus-flag" |

- npm sent `npm-command: <command>` and `npm-auth-type: web` on every fake registry request; with `--otp`, `npm-auth-type: legacy`.
- npm prints `npm notice` lines from the registry's `npm-notice` header. On 2026-10-20 the real registry sent "npm tokens that bypass 2FA are being restricted for account changes and direct publishing." on requests with no token.
- npm redacts paths that look like UUIDs in its output (`.../***/scratchpad/...`).

### 2.3 Can a caller tell the cases apart?

- **Exit code:** no. Every case above exits 1.
- **`--json`:** yes for errors that have a code: `error.code` on stdout is stable text, and an `EOTP` with `authUrl` carries the URLs. changesets and fledgling both read it this way (section 6). Limits: npm's own pre-checks give no code; `trust list --json` success output is not one document; lifecycle scripts can print to the same stdout (changesets takes the last JSON object for this reason).
- **Text only:** the stderr lines. They are for people and change between npm versions; for example `error-message.js` builds the `E401` text from the `www-authenticate` header.

## 3. Where npm keeps the login

### 3.1 npm 12.2.1 (source)

- `login.js` calls `config.setCredentialsByURI(registry, { token })`, then `config.save('user')`.
- `@npmcli/config` 11.2.0 `setCredentialsByURI` sets `//<host>/<path>/:_authToken=<token>` (the "nerf dart" of the registry URL) at the user level and deletes the `_password` and `username` lines for it.
- `save('user')` writes the user config file with `writeFile`, then `chmod 0o600` (`index.js` lines 868–897). An empty file is deleted.
- The user config file is the `userconfig` setting: default `~/.npmrc`; "This may be overridden by the `npm_config_userconfig` environment variable or the `--userconfig` command line option, but may _not_ be overridden by settings in the `globalconfig` file." (`definitions.js` line 2728). So a caller can keep the login in a file of its choice; the token is still a plain-text line.
- npmrc values expand `${NAME}` and `${NAME?}` from the environment (`env-replace.js`). So a file can hold `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` and the token can stay in the environment.
- npm 12.2.1 has no keychain, keyring or credential helper: a search of `lib/` and `@npmcli/config/lib/` for keychain, keytar, keyring and secret-service found none.
- npm 12 requires the scoped form for auth keys: a top-level `_authToken` is an error ("Legacy top-level auth keys ... must be in scoped/nerfdart form", commit 979518d).
- The web login token is a session token. Note 04, section 3: 2 h official lifetime, 2FA enforced on publish.

### 3.2 Bun 1.4.0 (probes against the fake registry)

| Setup (empty temp HOME unless named) | `bun pm whoami` | Request reached the fake registry? |
|---|---|---|
| `$HOME/.npmrc` with the fake registry and token | `probe-user`, exit 0 | Yes |
| `./.npmrc` in the project, same lines | `probe-user`, exit 0 | Yes |
| `NPM_CONFIG_TOKEN` and `NPM_CONFIG_REGISTRY` | `probe-user`, exit 0 | Yes |
| `NPM_CONFIG_USERCONFIG=<fake.npmrc>` | "error: missing authentication (run `bunx npm login`)", exit 1 | No |
| nothing | the same error, exit 1 | — |

- `bun info @probe/ok` with `NPM_CONFIG_USERCONFIG=<fake.npmrc>` went to registry.npmjs.org (404), not to the fake registry. So Bun 1.4.0 ignores the variable for the registry too.
- Bun's docs, read 2026-10-20, say the user-level file "is the file `NPM_CONFIG_USERCONFIG` ... points at when that variable is set". https://bun.com/docs/pm/npmrc
- The change came in oven-sh/bun PR #38047 (closed), folded into PR #44968 "install: consolidate the open package manager pull requests", merged 2026-10-14, after 1.4.3 (2026-10-10). So no released Bun has it on 2026-10-20: UNVERIFIED for any release after 1.4.3.
- Bun's docs list the sources in order: `~/.npmrc` (or `$XDG_CONFIG_HOME/.npmrc`), `./.npmrc`, `bunfig.toml`, `BUN_CONFIG_TOKEN`/`NPM_CONFIG_TOKEN`, then flags. Bun also expands `${NAME}` in `.npmrc`.
- Bun sent `npm-command: whoami` and `npm-auth-type: web` on `bun pm whoami`.
- So a token that npm writes to `~/.npmrc` is also read by `bun pm whoami`, `bun info` and `bun publish`. A token in a file named by `NPM_CONFIG_USERCONFIG` is not, on Bun 1.4.0.

## 4. npm's libraries instead of the CLI

### 4.1 The libraries (registry and installs, 2026-10-20)

| Library | Latest (date) | Direct dependencies | Installed packages, size | Bundled by `bun build --target=bun --minify` | Import under Bun (median of 5) |
|---|---|---|---|---|---|
| npm-registry-fetch | 20.0.1 (2026-06-02) | 8 (make-fetch-happen, minipass-fetch and others) | 46, 10.1 MB | 0.92 MB | 53 ms |
| npm-profile | 13.0.1 (2026-06-18) | 2 (npm-registry-fetch, proc-log) | 47, 10.1 MB | 0.93 MB | 58 ms |
| libnpmpublish | 12.0.1 (2026-09-22) | 8 (sigstore, npm-registry-fetch and others) | 71, 12.4 MB | 1.23 MB | 84 ms |
| libnpmaccess | 11.0.0 (2026-07-08) | 2 | 47, 10.1 MB | not built | 55 ms |
| libnpmorg | 9.0.0 (2026-07-08) | 2 | not installed | — | — |

- Every one declares `engines.node` `^22.22.2 || ^24.15.0 || >=26.0.0`. Bun 1.4.0 reports v26.3.0.
- The largest installed parts of npm-registry-fetch: lru-cache 3.6 MB, glob 1.7 MB, minimatch 0.7 MB, path-scurry 0.6 MB.
- npm 12.2.1 bundles exactly these versions (npm-profile 13.0.1, npm-registry-fetch 20.0.1, libnpmpublish 12.0.1, libnpmaccess 11.0.0, libnpmorg 9.0.0).

### 4.2 Probes under Bun 1.4.0 with no Node

- All four libraries loaded. Exports:
  - npm-registry-fetch: a function, plus `json`, `pickRegistry`, `getAuth`.
  - npm-profile: `createToken`, `get`, `listTokens`, `login`, `loginCouch`, `loginWeb`, `removeToken`, `set`, `webAuthCheckLogin`, `webAuthOpener`. Not called against any registry.
  - libnpmpublish: `publish`, `unpublish`. Not called.
  - libnpmaccess: `getCollaborators`, `getPackages`, `getVisibility`, `removePermissions`, `setAccess`, `setMfa`, `setPermissions`.
- npm-registry-fetch, real registry: `fetch.json("/-/package/@acmelabs%2fdesign-system/dist-tags")` returned `{"latest":"0.3.2"}` in 176 ms.
- npm-registry-fetch, fake registry: a GET of two configs succeeded. The error classes and codes came out as in the CLI: `EOTP` (`HttpErrorAuthOTP`, with `body.authUrl` for the web case), `E401` (`HttpErrorAuthUnknown`), `E404`, `E409`, `E429` (`HttpErrorGeneral`). A POST with a JSON array body got `E409`. A refused connection gave `ECONNREFUSED` and a bad host `ENOTFOUND`, both with a string `errno`.
- The library sends `npm-command` and `npm-auth-type` only when the caller passes `npmCommand` and `authType`. Web 2FA needs `npm-auth-type: web` (note 04, section 3).
- npm-registry-fetch calls make-fetch-happen directly (`lib/index.js` line 6 and line 108). No option takes a fetch function, so its requests do not pass through `World.fetch`.

### 4.3 What they cover

| npm-ops step | Library | Notes (source, npm 12.2.1 bundle) |
|---|---|---|
| Registry reads | npm-registry-fetch | Any GET |
| Web login | npm-profile `loginWeb(opener, opts)`, or `webAuthOpener` and `webAuthCheckLogin` | The caller supplies the opener that shows the URL. The caller stores the token |
| Org check | libnpmorg `ls(org)` (members), libnpmaccess `getPackages(scope)` | libnpmorg calls only `/-/org/{org}/user` (note 04). Nothing creates an org |
| Stage publish | libnpmpublish `publish(manifest, tarballData, { stage: true })` | `POST /-/stage/package/{name}`; returns `res.stageId` (`lib/publish.js` lines 61–74). The caller makes the tarball (npm uses libnpmpack); `bun pm pack` is another way |
| Stage approve, list, view | none | `lib/commands/stage/*.js` call npm-registry-fetch directly (`/-/stage/{id}/approve`, `/-/stage`) |
| Trusted publisher | none | `trust-cmd.js` `createConfig` calls npm-registry-fetch: `POST /-/package/{pkg}/trust` with `otplease` |

- npm/cli's `workspaces/` folder holds arborist, config, libnpmaccess, libnpmdiff, libnpmexec, libnpmfund, libnpmorg, libnpmpack, libnpmpublish, libnpmsearch, libnpmteam and libnpmversion (`gh api repos/npm/cli/contents/workspaces`, 2026-10-20). No library for trust or stage exists.
- So the libraries cover reads, login and the stage publish. The trusted publisher and the stage approval are only in the CLI, or in acmelabs's own calls.

## 5. Bun's own npm features in 1.4.0

| Feature | 1.4.0 result (probe, 2026-10-20) |
|---|---|
| `bun login` | "Uh-oh. bun login is a subcommand reserved for future use by Bun." |
| `bun pm whoami` | Prints the user; with no token: "error: missing authentication (run `bunx npm login`)", exit 1 |
| `bun info <pkg> [field] --json` | `bun info @acmelabs/design-system dist-tags --json` gave `{"latest": "0.3.2"}` with no token |
| `bun pm view` | Same as `bun info` ("use `bun info` instead", its help) |
| `bun publish --dry-run` | Packed and printed the summary; **sent no request** to the fake registry. With no token it ends "missing authentication", exit 1 |
| Stage publish | None. `bun publish --help` lists `--access`, `--tag`, `--otp`, `--auth-type` (default `web`), `--gzip-level`, `--tolerate-republish`, `--dry-run`, `--registry`; no stage flag |
| Trusted publisher | None. `bun pm trust` manages `trustedDependencies`, not npm's trusted publisher |
| OIDC and provenance | None (note 03, section 6) |

- oven-sh/bun PR #41293 "Add bun login and bun logout" is open (created 2026-09-03). It describes npm's web login with "print `loginUrl`, ENTER opens the browser, poll `doneUrl`, 5 minute cap", the token written to the user `.npmrc` at mode 0600, and says the browser prompt and `doneUrl` poll already live in `publish_command.rs` for `bun publish`'s web 2FA. https://github.com/oven-sh/bun/pull/41293

## 6. How others reach npm

### 6.1 changesets (`@changesets/cli` 3.0.3, 2026-09-14; main read 2026-10-20)

- `getPublishTool` (`packages/cli/src/commands/publish/getPublishTool.ts`) uses pnpm or Yarn Berry when the repo uses them, and npm otherwise. A Bun repo gets npm.
- `lib/npm.ts` runs `npm publish [<tarball>] --json --access <a> --tag <t> [--otp <code>]` through tinyexec, from the package folder, with piped output.
- It reads the last JSON object of stdout. `EOTP` becomes `failed:needs-2fa` and keeps `authUrl` and `doneUrl`.
- On `failed:needs-2fa` with a TTY, it runs the same `npm publish` again with `stdio: "inherit"`, so npm runs its own web 2FA on the terminal. The in-process use of `authUrl` is a disabled TODO: `if (false && result.authUrl != null && result.doneUrl != null)`.
- Without a TTY, a 2FA failure ends the publish.
- It holds no token. The OTP comes from `--otp` or `NPM_CONFIG_OTP`; it removes `NPM_CONFIG_OTP` and `npm_config_otp` from the child's environment and passes the code as a flag.
- It prints "Make sure to check the "skip 2fa for 5 minutes" option" when two or more packages need 2FA.

### 6.2 Yarn Berry (`@yarnpkg/cli` 4.18.1, 2026-09-24; master read 2026-10-20)

- `yarn npm login` uses web login by default for registry.npmjs.org and registry.yarnpkg.com, or with `--web-login` (`plugin-npm-cli/sources/commands/npm/login.ts`).
- It POSTs `/-/v1/login` itself with `npm-auth-type: web` and no auth, asks "Do you want to try to open your browser now?", then polls `doneUrl`, waiting `retry-after` seconds (default 1).
- It opens the URL with `open` (macOS), `xdg-open` (Linux) or `explorer.exe` (Windows); on failure it prints the URL (`yarnpkg-core/sources/nodeUtils.ts`).
- It stores the token as `npmAuthToken` under `npmRegistries` or `npmScopes` in the home `.yarnrc.yml` (`Configuration.updateHomeConfiguration`).

### 6.3 pnpm 12 (12.14.0 on `latest`; Rust; main read 2026-10-20)

- `pnpm/crates/auth-commands/src/login/web_login.rs` POSTs `-/v1/login` with `npm-auth-type: web` and polls `doneUrl`.
- It rejects a `loginUrl` or `doneUrl` that holds a control character ("a terminal-spoofing attempt").
- On a non-TTY stdout it prints the URL only, with no QR code. On a non-TTY stdin it skips the "Press ENTER to open the URL in your browser." prompt and only polls (`network-web-auth/src/prompt_browser_open.rs`).
- It opens the browser with the Rust `open` crate (`open::that_detached`).
- The classic fallback needs a terminal: `ERR_PNPM_LOGIN_NON_INTERACTIVE` "The login command requires an interactive terminal" (`test_non_interactive.rs`).
- It stores the token in pnpm's global `config.yaml`, not in `.npmrc` (`login.rs`). setup-npm-trusted-publish's README says pnpm 11 used `auth.ini` and pnpm 12.1 moved to `config.yaml`.

### 6.4 acmelabs-15/design-system (read 2026-10-20)

- `.github/workflows/publish-package.yml` (last changed in commit `6e2a086da1`, 2026-10-20) runs on `ubuntu-24.04` with `id-token: write` and environment `publish-package`. It sets up Bun 1.4.2 and has no `setup-node` step. It runs `bun scripts/release.ts publish`. This differs from note 03, section 6, which saw `setup-node` with Node 24.
- `scripts/release-npm.ts` `npmCommand` runs `Bun.spawn([process.execPath, "node_modules/npm/bin/npm-cli.js", ...args])`. It makes a temp folder with an empty user npmrc and an empty global npmrc and sets `NPM_CONFIG_USERCONFIG`, `NPM_CONFIG_GLOBALCONFIG`, `NPM_CONFIG_CACHE` and `NPM_CONFIG_UPDATE_NOTIFIER=false`. The folder is removed after each call.
- npm is a pinned devDependency, `"npm": "12.0.2"`. `release-policy.ts` checks npm 12.0.2 and Bun 1.4.2 before publishing. `verifyNpmCli` runs `npm --version` first.
- The publish command line is `publish <tarball> --access=public --provenance --ignore-scripts --loglevel=warn --registry=https://registry.npmjs.org` (all `=` forms). The child environment is an allow-list: `PATH`, temp folders, `CI`, the `GITHUB_*` names, `RUNNER_ENVIRONMENT`, `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`.
- The result, from the registry (`/@acmelabs%2fdesign-system/0.3.2`): `_npmVersion` 12.0.2, `_nodeVersion` 26.3.0, `_npmUser` "GitHub Actions" with `trustedPublisher.id` `github`, and an SLSA v1 provenance attestation. `_nodeVersion` 26.3.0 is the version Bun reports (section 1.2), which matches `process.execPath` being Bun.
- The tag run for v0.3.2 succeeded on 2026-10-20 at 21:20 UTC.
- It holds no token on any machine; CI uses OIDC. Its first version, 0.1.0, was published by hand (note 03).

### 6.5 Tools that set up a new package's trusted publisher

| Tool | Version (date) | How it reaches npm | What it holds |
|---|---|---|---|
| fledgling (dmno-dev) | 1.3.1 (2026-09-17) | Runs `npm` from PATH with `execFileSync`. It publishes a `0.0.0` placeholder, then runs `npm trust <provider> ... -y` with `stdio: 'inherit'` so npm runs 2FA on the terminal. It "warms" npm's 2FA by running `npm trust list` on the terminal first, then reads `npm trust list --json` with piped output | Nothing; it can take `--otp` or a TOTP secret and computes codes itself |
| setup-npm-trusted-publish (azu) | 2.2.0 (2026-10-10) | Publishes a placeholder with `npm publish` or `pnpm publish`; leaves the trusted publisher to the website | `NPM_TOKEN` from the environment, through a temp `.npmrc` with `${NPM_TOKEN}`, "never written to disk" |

- fledgling's `listTrust` parses `npm trust list --json` with one `JSON.parse` and says "npm allows at most one per package". With two or more configs the output is several documents (section 1.5), so that parse would fail. Note 04 says the limit has been 10 since 2026-09-03.
- setup-npm-trusted-publish's README: "Both `npm trust` and `npm access set mfa=...` require interactive 2FA OTP and cannot be driven by `NPM_TOKEN`".
- Sources: https://github.com/dmno-dev/fledgling (`src/npm.ts`), https://github.com/azu/setup-npm-trusted-publish, registry `time` fields, all read 2026-10-20.
- The "about 5 minutes" 2FA reuse comes from fledgling's comments and changesets' message. npm's docs were not checked for it: UNVERIFIED.

## 7. Opening a browser from a CLI

### 7.1 npm 12.2.1 (source)

- npm opens URLs with `@npmcli/promise-spawn` 10.0.0 `open`, not the `open` package. It runs with `shell: true`:
  - macOS: `open <url>`.
  - Linux: `xdg-open <url>`.
  - WSL (Linux with "microsoft" in `os.release()`): `sensible-browser`, and it fails unless `BROWSER` is set.
  - Windows: `start ""` through `ComSpec`.
- The `browser` config: default `null` (the platform opener); `false` prints the URL instead; `true` uses the platform opener; a string names the command.
- `openUrl` treats exit code 127 (command not found) as "print the URL" ("Browser unavailable. Please open the URL manually"). Any other non-zero exit is thrown. So a Linux machine with `xdg-open` installed but no way to open a URL (exit 3) would fail the login after ENTER, not print the URL. From source; not run.
- npm reaches the opener only with a TTY, after ENTER (section 1.4).

### 7.2 `open` and `xdg-open`

- macOS `open` hands the URL to Launch Services; it needs no `DISPLAY`. No probe ran it, to keep a browser from opening on this machine.
- xdg-open is "for use inside a desktop session only" (xdg-open(1)). Exit codes: 0 success, 1 syntax, 2 a file is missing, 3 "A required tool could not be found", 4 "The action failed" (portland.freedesktop.org/doc/xdg-open.html; manpages.debian.org bookworm; read 2026-10-20).
- With no desktop found, xdg-open's `open_generic` tries `$BROWSER` (a colon list), then, with no display (`DISPLAY` and `WAYLAND_DISPLAY` unset), the text browsers `www-browser:links2:elinks:links:lynx:w3m`, then exits 3 "no method available for opening". A text browser, if installed, runs in the same terminal. Source: the xdg-open script as vendored at https://github.com/sindresorhus/opn/blob/master/xdg-open; the freedesktop GitLab copy was behind bot protection on 2026-10-20, so the current upstream text is UNVERIFIED.
- "In case of success the process launched from the .desktop file will not be forked off" (xdg-open(1), openSUSE Tumbleweed): xdg-open may run as long as the browser.

### 7.3 gh's `--web` flows (cli/cli, latest release v2.102.1, 2026-10-20; local gh 2.98.0)

- `internal/authflow/flow.go`: gh prints "! First copy your one-time code: <code>". Not interactive: "Open this URL to continue in your web browser: <url>". Interactive: "Press Enter to open <url> in your browser... ", then it opens; on failure it prints "Failed opening a web browser at <url>" and "Please try entering the URL in your browser manually".
- The launcher (`go-gh/pkg/browser`): the `GH_BROWSER` variable, then the `browser` setting in gh's config, then `BROWSER`.
- With none set, `cli/browser` on Linux tries `xdg-open`, `x-www-browser`, `www-browser`, `wslview`, the first one found on PATH.

## Ways npm-ops could reach npm

All facts from sections 1 to 7. "Fake World" is the repo's `fakeWorld`, which scripts each outside program as a command line, and "fake fetch" scripts each request (spec `SPEC-command-core.md`).

| | (a) The npm CLI under Bun through `bunx npm@<pinned>` | (b) The npm CLI as a pinned dependency of `@acmelabs/cli`, run as `bun <path>/npm/bin/npm-cli.js` | (c) npm's libraries: npm-registry-fetch, npm-profile, libnpmpublish | (d) Bun's fetch with acmelabs's own calls |
|---|---|---|---|---|
| Who holds the token, and where | npm. The user npmrc: `~/.npmrc` by default, mode 0600, or the file `NPM_CONFIG_USERCONFIG` names. acmelabs never reads it. Bun 1.4.0 reads `~/.npmrc` too | As (a) | acmelabs. The libraries take it as an option (`forceAuth.token` or a `//host/:_authToken` key); acmelabs chooses where to store it | acmelabs, in a store it chooses; acmelabs's redaction must cover it |
| Login | `npm login`: prints the URL, polls `doneUrl`, writes the token (source; not run) | As (a) | npm-profile `loginWeb` with an opener acmelabs writes; acmelabs writes the token | `POST /-/v1/login`, poll `doneUrl` (protocol not documented, note 04) |
| Stage publish | `npm stage publish --tag=<tag>` when the version is a prerelease; no 2FA; `--json` gives `stageId` (source) | As (a) | libnpmpublish `publish(..., { stage: true })` returns `stageId`; acmelabs packs the tarball | `POST /-/stage/package/{name}` with the body libnpmpublish builds (body format: note 13) |
| Trusted publisher | `npm trust github <pkg> --file=<f> --repo=<o/r> --allow-publish --yes`; 2FA: npm's own web flow on a TTY; with no TTY `EOTP` plus `authUrl`/`doneUrl`, then a rerun with `--otp=<code>` | As (a) | No library: npm-registry-fetch `POST /-/package/{pkg}/trust` with the OTP | `POST /-/package/{pkg}/trust` (documented, note 04), web 2FA by acmelabs |
| Reads | `npm whoami`, `npm view`, `npm trust list`, `npm stage list`; or plain fetch for public reads | As (a) | npm-registry-fetch | fetch |
| Dependency and size cost | None in `@acmelabs/cli`. First use downloads npm: 5.25 s cold, 17 MB in the bunx folder plus 45 MB in Bun's cache. A warm call: 0.04–0.31 s | 1 package with 182 bundled, 16.6 MB, in every repo that pins `@acmelabs/cli` (ADR-0004). `bun build` does not bundle it: the output (6.55 KB) loads npm's `lib` from its install path | 46–71 packages, 10.1–12.4 MB installed; 0.92–1.23 MB bundled; 53–84 ms import | None |
| Node-free status | Verified for reads, help, dry runs and every error path probed. `login`, a real stage publish and a real `trust github`: UNVERIFIED (not run). CI publish with OIDC: verified through design-system | Verified: `bun npm-cli.js whoami --json` with no Node; design-system's CI publish | Verified: load, a GET (real registry), a POST and the errors (fake registry). npm-profile and libnpmpublish calls: UNVERIFIED | Bun's fetch is Bun's own; the npm calls were not made here |
| How a test fakes it | Each call is a command line through the fake World: scripted stdout, stderr and exit 1 with the `--json` error | As (a) | Their requests go through make-fetch-happen and `node:http`, not `World.fetch`; npm-registry-fetch takes no fetch function. A test needs a local fake registry, as these probes used, or module mocks | Every request through the fake fetch |
| Main risk | npm 12's flag parsing for `npm trust` (global flags must follow the subcommand in `=` form, PR #9295 open); `trust list --json` is not one document; every failure exits 1, so the `--json` code carries the meaning; `--json` hides the login URL; output text can change between npm versions; the first use needs the registry to fetch npm | As (a), plus 16.6 MB in each repo; the npm version moves only with `@acmelabs/cli` releases | acmelabs holds the token, which ADR-0014 avoided for GitHub; the requests skip the World's limits and the fake fetch; no library for the trusted publisher or the stage approval | acmelabs holds the token; the login endpoint is not documented; the publish body must stay in step with npm's; the 429 retries and the OTP flow become acmelabs's code |

In every row, CI still publishes with the npm CLI, because `bun publish` has no OIDC or provenance (ADR-0006).

## Gaps

| Open point | The probe or source that would settle it |
|---|---|
| `npm login` under Bun on a real terminal, end to end | Peter runs `bunx npm@12.2.1 login` with a temp `NPM_CONFIG_USERCONFIG`, then `bunx npm@12.2.1 whoami` |
| A real `npm stage publish` and `npm trust github` under Bun | The first library repo's setup, run under Bun with `--json`; record stdout, `stageId` and the 2FA flow |
| Whether the staged version must be `0.0.0-stage`, or the registry makes the placeholder version itself | npm's changelog and docs (the staged-publishing doc, last edited 2026-05-20, still says a brand-new package cannot be staged); note 13 |
| Whether `npm login --json` prints the URL only at exit | Run it against the fake registry with a `/-/v1/login` route |
| The `doneUrl` of a web OTP: does polling it need the bearer token? | npm-profile `webAuthOpener` passes the request options with the token; a run against the real registry |
| The "about 5 minutes" 2FA reuse after a web OTP | npm's docs on web 2FA; a timed probe |
| Bun's `NPM_CONFIG_USERCONFIG` support in the next release after 1.4.3 | Bun's release notes; rerun the `bun pm whoami` probe of section 3.2 |
| Whether a warm `bunx npm@<pinned>` checks the registry | Run it with the network off |
| xdg-open on a Linux runner with no display, and npm's exit-3 path | Run `xdg-open https://example.com` and an `openUrl` call on `ubuntu-latest` |
| npm/cli PR #9295 (argv offset): merged, and in which version | Watch https://github.com/npm/cli/pull/9295 |
| Glossary: `CONTEXT.md` has no entry for web login, web 2FA, the user npmrc, or a stage id | Raise them through the domain-modeling skill |
