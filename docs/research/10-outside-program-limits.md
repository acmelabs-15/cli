# Limits for outside programs and requests

What this is: research for open questions 21 and 22 of `spec/README.md`, ahead of the `github-ops` spec. Question 21 asks whether outside programs should get only an allowlist of environment variables. Question 22 asks whether outside programs and HTTP requests should get a byte cap and a default time limit. The note collects facts and options. It decides nothing. Researched on 2026-10-20 by a research agent, with Exa, `gh api` reads of public source, the local manuals, and probes.

Versions on the probe machine (macOS 26.6.2, arm64): Bun 1.4.0 (`34cbb9a40`), `bun-types` 1.4.0 (the repo installs `@types/bun` 1.4.3), gh 2.98.0 (built with go1.26.7), git 2.54.0 (Apple Git-157), Claude Code 2.1.304, Gemini CLI 0.58.0, agy 1.2.7, npm 11.19.0. The probe scripts sit in the session scratchpad (`limits-probe/`). They are temporary. This note keeps their results. No probe printed a secret; environment listings show names only.

## 1. What the code does today

- `realWorld().spawn` calls `Bun.spawn` with no `env`. So every child gets the whole environment of the CLI, as it was at launch. `packages/cli/src/command/world.ts`
- It reads `stdout` and `stderr` with `.text()`, with no byte cap. It sets no time limit. A cancel kills the direct child with SIGTERM (Bun's default `killSignal`). (same file)
- `context.fetch` gets the run's cancel signal and nothing else. `packages/cli/src/command/run.ts`
- The redaction rule treats an environment value as a secret when its name matches `/TOKEN|SECRET|KEY|PASSWORD/iu` and the value has 8 characters or more. `packages/cli/src/command/redact.ts`
- **Probe, today's code with a cancel:** `realWorld().spawn(["bash", "-c", "(sleep 3; echo late) & sleep 10"])`, cancelled at 300 ms. The call rejected at 10,019 ms, and the process exited at 10,020 ms. The orphaned `sleep 10` holds the stdout pipe, so `.text()` waits for it. By its code (not probed), `runCommand` reports the cancel at once through its `untilAborted` race; the probe shows the process cannot exit until the pipe closes.
- **Probe, a flood with no cap:** `.text()` on 200 MiB of output took 287 ms, and the resident memory grew by 599 MiB.
- The names in this shell that match the redaction rule are `JEV_API_KEY`, `CLAUDE_CODE_MESSAGING_TOKEN` and `MAX_MCP_OUTPUT_TOKENS`. The last one holds a number, not a secret.

## 2. `Bun.spawn` on Bun 1.4.0

### Options and documents

- **`env` replaces the environment. It does not merge.** The default is "`process.env` as it was when the current Bun process launched"; a later change to `process.env` is not seen. Types: `bun-types` 1.4.0 `bun.d.ts`, `BaseOptions.env` (https://www.npmjs.com/package/bun-types/v/1.4.0). Docs: https://bun.com/docs/runtime/child-process (the example merges by hand: `env: { ...process.env, FOO: "bar" }`).
- **`timeout`, `killSignal` and `maxBuffer` sit in `BaseOptions`**, which both `SpawnOptions` and `SpawnSyncOptions` extend. So the types allow all three on `Bun.spawn`. `killSignal` also sets the signal for an abort and for `maxBuffer`. Default `killSignal` is SIGTERM. (`bun.d.ts`, `BaseOptions`)
- **The docs describe `maxBuffer` "for `Bun.spawnSync`" only.** They say the output "can exceed `maxBuffer` only by the single read that passed it". https://bun.com/docs/runtime/child-process#using-maxbuffer
- **`exitedDueToTimeout` and `exitedDueToMaxBuffer` exist on `SyncSubprocess` only.** `Subprocess` (from `Bun.spawn`) has `exited`, `exitCode`, `signalCode` and `killed`. (`bun.d.ts`)
- **`killed` has two meanings in the sources.** The type comment says "Whether the process has exited". The web docs say "was the process killed?". (`bun.d.ts`; https://bun.com/docs/runtime/child-process#exit-handling)
- **`detached: true` calls `setsid()`.** The child starts a new session and leads its own process group. (`bun.d.ts`, `BaseOptions.detached`)

### Probe results: `env`

| Case | What the child saw |
|---|---|
| No `env` option | All 76 parent names, including a marker set before launch |
| `env: { ONLY_THIS: "1" }` | Only `ONLY_THIS` |
| `env: {}` | No variables at all |
| `env: { A: "1", B: undefined }` | Only `A`; an `undefined` value is dropped |
| `process.env.X` set at runtime, no `env` option | `X` absent, as the type comment says |
| `env` with no `PATH`, program `env` by bare name | The program started: Bun looked it up on the parent's `PATH`. The child got no `PATH`. |
| `env: { PATH: "/nonexistent" }`, program by bare name | `Bun.spawn` threw `Executable not found in $PATH: "env"` (ENOENT): the lookup used the given `PATH` |

`Bun.env === process.env` is `true`.

### Probe results: `timeout`, `killSignal`, cancel

| Case | Wall time | `exited` | `exitCode` | `signalCode` |
|---|---|---|---|---|
| `timeout: 300`, `sleep 5` | 304 ms | resolves 143 | null | SIGTERM |
| `timeout: 300`, `killSignal: "SIGKILL"` | 302 ms | resolves 137 | null | SIGKILL |
| `timeout: 300`, program ignores SIGTERM (`trap '' TERM; sleep 3`) | 3,011 ms | resolves 0 | 0 | null |
| Signal aborts at 200 ms, `timeout: 2000` | 203 ms | resolves 143 | null | SIGTERM |
| No limit, program sends itself SIGTERM | 3 ms | resolves 143 | null | SIGTERM |
| No limit, program exits 7 | 4 ms | resolves 7 | 7 | null |

- `exited` resolves on a time-out. It does not reject.
- A time-out, a cancel and an outside SIGTERM look the same: exit 143, `signalCode` SIGTERM. Code that must tell them apart has to track its own timer.
- Bun does not escalate. A program that ignores SIGTERM runs to its own end.
- `killed` read `true` after the normal `exit 7`.

### Probe results: `maxBuffer`

| Case | Wall time | Ending | Bytes delivered |
|---|---|---|---|
| `Bun.spawn`, `maxBuffer: 1000`, `yes` | 5 ms | 143, SIGTERM | stdout 49,140 B |
| `Bun.spawn`, `maxBuffer: 1000`, `yes >&2` | 6 ms | 143, SIGTERM | stderr 49,140 B |
| `Bun.spawn`, `maxBuffer: 1000`, 600 B stdout, then 600 B stderr | 1,229 ms | 0 | 600 B and 600 B |
| `Bun.spawnSync`, `maxBuffer: 1000`, `yes` | | SIGTERM, `exitedDueToMaxBuffer: true` | stdout 40,950 B |
| `Bun.spawnSync`, `timeout: 300`, `sleep 5` | | SIGTERM, `exitedDueToTimeout: true` | |

- `maxBuffer` works on `Bun.spawn` on 1.4.0, against the docs' scope.
- It counts each stream on its own, not their sum.
- It stops the program, but the stream still delivers the whole pipe read: 49,140 B for a 1,000 B cap. It is not a memory cap.
- A runtime check found no `exitedDueToTimeout` or `exitedDueToMaxBuffer` field on a `Subprocess` after either ending.

### Grandchildren hold the pipes

Bun's `timeout`, `signal` and `kill()` signal the child's pid only. A grandchild that inherited the pipe keeps it open.

| Case | `exited` | Pipe closed |
|---|---|---|
| `timeout: 300`, `bash -c "(sleep 2; echo late) & sleep 10"` | 143 at 308 ms | stdout `"late\n"` at 10,034 ms |
| Same, `detached: true` and Bun's own `timeout: 300` | 143 at 304 ms | stdout at 10,011 ms |
| Same, `detached: true`, then `process.kill(-pid, "SIGTERM")` at 300 ms | 143 at 312 ms | stdout `""` at 312 ms |

- A real case: `git ls-remote https://…` with no credential, inside a terminal (`script` pseudo-terminal), `timeout: 5000`, `killSignal: "SIGKILL"`. git died at 5 s (137), but stderr stayed open until 13,978 ms, held by a git helper process. Which helper: UNVERIFIED (likely `git-remote-https`).
- `kill(-pgid, sig)` signals every process in a group; a child stays in its parent's group by default. On Linux `bun run --no-orphans` adds `PR_SET_PDEATHSIG`; macOS has no equivalent. https://github.com/oven-sh/bun/pull/43438 (open, 2026)
- Prior art does the same: Renovate starts each child with `detached: true` (not on Windows) and kills `-pid`. https://github.com/renovatebot/renovate/blob/main/lib/util/exec/common.ts · execa has `killDescendants` (default `false`), which "spawns the subprocess in its own process group" on Unix. https://github.com/sindresorhus/execa/blob/main/docs/api.md#optionskilldescendants

### Prompts on the terminal bypass stdin

- git asks for a password on `/dev/tty`, not on stdin. `GIT_TERMINAL_PROMPT=0` turns that off. `git help git`, ENVIRONMENT VARIABLES (git 2.54.0); https://git-scm.com/docs/git#Documentation/git.txt-GITTERMINALPROMPT
- **Probe** (same git call, `env: { PATH }`, in a pseudo-terminal whose input stays open and silent, limit 5 s):

| Variant | Ending |
|---|---|
| Not detached | prompt shown; killed by the time limit (137); pipe held to 13,978 ms |
| Not detached, `GIT_TERMINAL_PROMPT=0` | exit 128 at about 1,200 ms, "terminal prompts disabled" |
| `detached: true` (no controlling terminal) | exit 128 at 210 ms, "Device not configured" |

- With no terminal at all (as in CI), git fails at once: "could not read Username … Device not configured" (198 ms).
- A detached child is outside the terminal's foreground group, so Ctrl+C does not reach it. The CLI's own cancel must kill the group. UNVERIFIED by probe.

### A byte cap and a time limit by hand: working probe

```ts
// Reads one stream; past `cap` bytes it keeps the first `cap`, calls onOver (which kills), and stops.
async function readCapped(stream: ReadableStream<Uint8Array>, cap: number, onOver: () => void) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: Buffer.concat(chunks), over: false };
    if (total + value.byteLength > cap) {
      chunks.push(value.subarray(0, cap - total));
      onOver();
      await reader.cancel();
      return { bytes: Buffer.concat(chunks), over: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
}
// Caller: Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", timeout, killSignal: "SIGKILL" }),
// then Promise.all([readCapped(stdout, cap, kill), readCapped(stderr, cap, kill), child.exited]).
```

| Case (cap 1 MiB) | Wall time | Ending | Bytes kept |
|---|---|---|---|
| `yes` | 7 ms | 137, SIGKILL, over | stdout exactly 1,048,576 B |
| `yes >&2` | 14 ms | 137, SIGKILL, over | stderr exactly 1,048,576 B |
| Small output, exit 2 | 10 ms | 2 | 6 B and 5 B |
| `sleep 5`, `timeout: 300` | 302 ms | 137, SIGKILL | 0 B |
| `bash -c "trap '' TERM; sleep 3"`, `timeout: 300` | 3,031 ms | 137 | 0 B: bash died at 300 ms, its `sleep 3` held the pipes |

The last row shows that SIGKILL on the pid is not enough when a grandchild exists. The group kill of the table above is.

## 3. `fetch` on Bun 1.4.0

- **The documented time limit is `AbortSignal.timeout(ms)`.** https://bun.com/docs/runtime/networking/fetch#fetching-a-url-with-a-timeout
- **Bun reads `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` (upper or lower case) each time `fetch` runs, and `NO_PROXY`.** A `proxy` option overrides them; `proxy: false` connects directly. (same page, "Proxying requests")
- **`decompress` defaults to `true`.** (`bun-types` 1.4.0 `globals.d.ts`, `BunFetchRequestInit.decompress`)
- The CLI's own `fetch` runs inside the CLI process. An environment filter for outside programs does not change it.

Probe results against a local `Bun.serve` server and a raw `Bun.listen` socket:

| Case | Wall time | Result |
|---|---|---|
| `AbortSignal.timeout(300)`, headers come after 3 s | 303 ms | `DOMException`, name `TimeoutError`, code 23, "The operation timed out." |
| `controller.abort()` with no reason at 200 ms | 202 ms | `DOMException`, name `AbortError`, code 20 |
| `AbortSignal.any([cancel, AbortSignal.timeout(300)])`, time-out first | 300 ms | `TimeoutError`; `signal.reason` is the same `TimeoutError` |
| `AbortSignal.any([cancel, AbortSignal.timeout(2000)])`, cancel first | 200 ms | `AbortError` |
| `timeout(1200)`, headers at once, body 1 byte per 500 ms | 1,201 ms | `response.text()` rejects with `TimeoutError` |
| Raw socket: header bytes trickle, `timeout(1000)` | 1,000 ms | `TimeoutError` |
| No signal, headers after 3 s | 3,002 ms | 200 OK: no default time limit inside 3 s. A longer default: UNVERIFIED |
| Raw socket: `Content-Length: 10`, sends 1 MiB | 5 ms | Bun reads 10 B: HTTP framing stops at the header's length |
| Raw socket: `Content-Length: 100000000`, sends 10 B, holds the socket | 1,001 ms | `TimeoutError`: only the time limit ends it |
| Body cap 1 MiB by stream reader, 50 MiB body with `Content-Length` | 12 ms | Rejected by the header, 0 B read |
| Body cap 1 MiB by stream reader, endless chunked body | 4 ms | Stopped at 1,097,512 B (the read that passed the cap) |
| gzip body, `Content-Length: 10221` | | 10,485,760 B after decompression |
| `Bun.serve` with a user `Content-Length` on a streamed body | | Bun sent the body chunked; the client saw no `Content-Length` |

- So a `TimeoutError` tells a time-out from a cancel (`AbortError`, or the cancel's own reason when it has one).
- `Content-Length` can reject a large body early. It is no cap: a chunked body has none, and a gzip body grew about 1,000 times past it here. Only a reader that counts bytes caps the body.
- Bun supports `NODE_EXTRA_CA_CERTS` since v1.1.22 (2024-08-07), for the runtime and `bun install`. https://bun.com/blog/bun-v1.1.22 · On 1.4.0 a user reports that `bun install` still fails with it (2026-08-21); a fix on `main` is claimed (2026-07-24). https://github.com/oven-sh/bun/issues/17325 · `NODE_USE_SYSTEM_CA=1` and `--use-system-ca` use the OS store. (same issue; the `--use-system-ca` flag in the `bun run` docs, `bun-types` 1.4.0 `docs/snippets/cli/run.mdx`)

## 4. The environment each planned program needs

### Measured on this Mac

Exit code of each program with an empty environment and with only `HOME` and `PATH`:

| Command line | `env: {}` | `{ HOME, PATH }` | Note |
|---|---|---|---|
| `gh api rate_limit` | 4, "To get started with GitHub CLI, please run: gh auth login" | 0 | `{ HOME }` alone also works: gh reaches its keychain login with `HOME` only |
| `gh api rate_limit` with `GH_TOKEN=<not a real token>` | | 1, "Bad credentials (HTTP 401)" | |
| `git ls-remote https://github.com/acmelabs-15/cli.git` | 0 | 0 | public repo, no credential needed |
| `claude plugin validate . --strict` (in brain) | 0 | 0 | also 0 with `HOME=/nonexistent-home` |
| `gemini extensions validate .` (in brain) | 127, "env: node: No such file or directory" | 0 | Gemini CLI is a Node script; `PATH` must hold `node` |
| `agy plugin validate .` (in brain) | 1, "failed to resolve GeminiDir: $HOME is not defined" | 0 | |
| `npm --version` | 127, same as gemini | 0 | |
| `bun --version` | 0 | | |

- `npm whoami` fails with E401 in every environment, the full one included: this machine's npm login is stale. It is not an environment effect.
- gh's login here sits in the macOS keychain (`gh auth status` says "keyring"). Nothing beyond `HOME` was needed to reach it.

### gh (2.98.0)

- **Needed to work:** `HOME` (to find its config, which says where the login is). Config: `GH_CONFIG_DIR`, else `$XDG_CONFIG_HOME/gh`, else `$HOME/.config/gh` (`$AppData` on Windows). https://cli.github.com/manual/gh_help_environment
- **Auth:** `GH_TOKEN`, then `GITHUB_TOKEN`, for github.com and `*.ghe.com`; `GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN`, for GitHub Enterprise Server; `GH_HOST`. A token in the environment wins over the stored login. (same page)
- **Prompts and noise:** `GH_PROMPT_DISABLED`, `GH_NO_UPDATE_NOTIFIER`, `GH_SPINNER_DISABLED`, `NO_COLOR`, `GH_TELEMETRY`, `DO_NOT_TRACK`. (same page)
- **Agent detection:** gh reads `AI_AGENT`, `CLAUDECODE`, `CLAUDE_CODE`, `GEMINI_CLI`, `CODEX_SANDBOX`, `CODEX_CI`, `CODEX_THREAD_ID`, `ANTIGRAVITY_AGENT` and others, and changes its User-Agent and its error output for an agent. https://github.com/cli/cli/blob/trunk/internal/agents/detect.go (read 2026-10-20)
- **Proxy:** gh is a Go program. Go's `ProxyFromEnvironment` reads `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, or their lower-case forms. https://pkg.go.dev/net/http#ProxyFromEnvironment
- **Certificates:** Go reads `SSL_CERT_FILE` and `SSL_CERT_DIR`. On macOS and Windows these override the system verifier only from Go 1.27. https://pkg.go.dev/crypto/x509#SystemCertPool · The local gh 2.98.0 is built with go1.26.7, so on this Mac they do not apply to it (`go version $(which gh)`).
- **Exit codes:** 0 done, 1 failed, 2 cancelled, 4 authentication required. https://cli.github.com/manual/gh_help_exit-codes

### git (2.54.0)

- **Needed to work:** nothing for a public read. `HOME` and `XDG_CONFIG_HOME` locate the user config (`$HOME/.gitconfig`, `$XDG_CONFIG_HOME/git/config`); `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` and `GIT_CONFIG_NOSYSTEM` replace them. https://git-scm.com/docs/git#_environment_variables
- **On this Mac a push needs `HOME`:** `~/.gitconfig` sets `credential.https://github.com.helper` to `!/opt/homebrew/bin/gh auth git-credential`. Without `HOME`, git falls back to the system `osxkeychain` helper and then to a `/dev/tty` prompt (section 2). `git config --show-origin`
- **Auth:** `credential.helper`; `GIT_ASKPASS`; `GIT_TERMINAL_PROMPT`; `SSH_AUTH_SOCK` for an ssh agent; `GIT_SSH`, `GIT_SSH_COMMAND`. https://git-scm.com/docs/git#_environment_variables · https://git-scm.com/docs/git-config#Documentation/git-config.txt-credentialhelper
- **In CI:** `actions/checkout` has `persist-credentials`, default `true`: it writes "the token or SSH key" into the repo's local git config. So a later git call in the job needs no token variable, and any child that can read `.git/config` can read the token. https://github.com/actions/checkout/blob/main/action.yml (v7.0.1, 2026-07-20)
- **Proxy:** `http_proxy`, `https_proxy` and `all_proxy` (as curl reads them); `http.proxy` overrides. https://git-scm.com/docs/git-config#Documentation/git-config.txt-httpproxy
- **Certificates:** `GIT_SSL_CAINFO` and `GIT_SSL_CAPATH` (`http.sslCAInfo`, `http.sslCAPath`); `GIT_SSL_NO_VERIFY`. (same page)
- **Config without a file:** `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`. (same page)

### claude (`claude plugin validate`, 2.1.304)

- **Needed to work:** nothing, by probe (`env: {}` passed). Whether `validate` uses the network: UNVERIFIED.
- **Config:** `CLAUDE_CONFIG_DIR` moves the config folder (default `~/.claude`). https://code.claude.com/docs/en/authentication
- **Auth (not needed by `validate`):** `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`. https://code.claude.com/docs/en/env-vars
- **Proxy:** `https_proxy`, `HTTPS_PROXY`, `http_proxy`, `HTTP_PROXY`, in that order, and `NO_PROXY`. No SOCKS. https://code.claude.com/docs/en/network-config
- **Certificates:** the bundled Mozilla set plus the OS store by default (`CLAUDE_CODE_CERT_STORE`); `NODE_EXTRA_CA_CERTS`; mTLS with `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`. (same page)

### gemini (`gemini extensions validate`, 0.58.0)

- **Needed to work:** `PATH` with `node` on it (probe). `HOME` for user config.
- **Config:** `GEMINI_CLI_HOME`, "the root directory for Gemini CLI's user-level configuration", default the home folder. Gemini CLI also loads a `.env` file from the working folder upwards, then `~/.env`. https://geminicli.com/docs/reference/configuration/ (dated 2026-10-15)
- **Auth (not needed by `validate`):** `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`. (same page)
- **Proxy and certificates:** not found in the configuration page. UNVERIFIED.

### agy (`agy plugin validate`, 1.2.7)

- **Needed to work:** `HOME` (probe). Plugins live under `~/.gemini/antigravity-cli/plugins/`. https://www.antigravity.google/docs/cli/plugins/
- **Config-folder variable, proxy, certificates:** none found in the docs. UNVERIFIED.

### bun (1.4.0)

- **Needed to work:** nothing for `bun --version` (probe).
- **`bun install`:** `BUN_CONFIG_REGISTRY` or `NPM_CONFIG_REGISTRY`; `BUN_CONFIG_TOKEN` or `NPM_CONFIG_TOKEN`; `.npmrc` in `HOME` and in the project, with `${NAME}` replaced from the environment; `BUN_INSTALL_CACHE_DIR`. https://bun.com/docs/pm/cli/install · https://bun.com/docs/pm/npmrc
- **Runtime:** `TMPDIR`, `NO_COLOR`, `FORCE_COLOR`, `NODE_TLS_REJECT_UNAUTHORIZED`, `BUN_CONFIG_MAX_HTTP_REQUESTS` (default 256), `DO_NOT_TRACK`, `BUN_OPTIONS`. https://bun.com/docs/runtime/environment-variables
- **Proxy and certificates:** section 3.

### npm (11.19.0 here; open question 9 plans `bunx npm@12` for the CI publish)

- **Needed to work:** `PATH` with `node` on it (probe).
- **Config:** every `npm_config_*` variable, in any case (`NPM_CONFIG_FOO` works). `NPM_CONFIG_USERCONFIG` (default `$HOME/.npmrc`) and `NPM_CONFIG_GLOBALCONFIG`. https://docs.npmjs.com/cli/v11/using-npm/config
- **Auth:** `actions/setup-node` with `registry-url` writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into the `.npmrc` at `NPM_CONFIG_USERCONFIG`; npm expands the variable at publish time. https://github.com/npm/documentation/issues/1960
- **Trusted publishing:** needs npm 11.5.1 or later and `id-token: write`. npm "automatically detects OIDC environments". https://docs.npmjs.com/trusted-publishers/ · The variables it reads on GitHub Actions are `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`. https://github.com/npm/cli/pull/8336 · https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers
- **Proxy:** `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`; `noproxy` defaults to `NO_PROXY`. https://docs.npmjs.com/cli/v11/using-npm/config
- **Certificates:** `cafile`, `ca`; `NODE_EXTRA_CA_CERTS` through Node. (same page; https://nodejs.org/learn/http/enterprise-network-configuration)
- Whether npm 12 changed any of these: UNVERIFIED.

### Standard variables

- **Every program:** `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG` and `LC_*`, `TERM`, `SHELL`. Codex's `core` set on Unix holds 11 names: `PATH, SHELL, TMPDIR, TEMP, TMP, HOME, LANG, LC_ALL, LC_CTYPE, LOGNAME, USER` (no `TERM`). https://github.com/openai/codex/blob/main/codex-rs/protocol/src/shell_environment.rs
- **Proxy:** `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`, each in both cases (sections 3 and 4).
- **Certificates:** `SSL_CERT_FILE`, `SSL_CERT_DIR` (Go, OpenSSL), `NODE_EXTRA_CA_CERTS` (Node, Bun, Claude Code), `NODE_USE_SYSTEM_CA` (Node 22.19+, 24.6+; Bun), `GIT_SSL_CAINFO`, `GIT_SSL_CAPATH` (git). https://nodejs.org/learn/http/enterprise-network-configuration
- **GitHub Actions runners:** `CI=true`; `GITHUB_*` (repository, ref, SHA, event path, workspace and others); `RUNNER_*` (OS, arch, temp, tool cache). The default-variables table has no `GITHUB_TOKEN`: a workflow passes it in `env` itself. https://docs.github.com/en/actions/reference/workflows-and-actions/variables · With `id-token: write`, also `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` (above).

## 5. Prior art: passing only some variables

- **Turborepo (2.11.9, 2026-10-16): an allowlist.** Strict mode is the default since PR #8182 (merged 2024-05-22). It passes only variables named in `env`, `globalEnv`, `passThroughEnv` and `globalPassThroughEnv`, plus a built-in list. `--env-mode=loose` passes everything. https://turborepo.com/docs/crafting-your-repository/using-environment-variables · https://github.com/vercel/turborepo/pull/8182
  - The built-in list (62 names and patterns) holds `HOME`, `USER`, `TZ`, `LANG`, `SHELL`, `PWD`, `PATH`, `TMP`, `TEMP`, `TERM`, `CI`, `NODE_OPTIONS`, `COREPACK_*`, `DOCKER_*`, `VSCODE_*`, `TURBO_*`, `VERCEL_*`, `GITHUB_*`, `RUNNER_*`, `NIX_*` and Windows names. It holds no proxy variable, no certificate variable and no `TMPDIR`. `GITHUB_*` lets `GITHUB_TOKEN` through. https://github.com/vercel/turborepo/blob/main/crates/turborepo-env/src/lib.rs (last change 2026-09-13)
  - The list grew after breakages: "Pass `TURBO_*` env vars through to child processes in Strict Mode" (#12372) and "Add NixOS environment variables to default passthroughs" (#12417), both in 2.8.x. https://github.com/vercel/turborepo/compare/v2.7.5...v2.9.8
  - Turborepo's own guide warns that strict mode filters CI variables, with the symptom "authentication required" or "permission denied". https://github.com/vercel/turborepo/blob/main/skills/turborepo/references/environment/gotchas.md
- **Bazel (9.3.0, 2026-10-07): `--incompatible_strict_action_env`.** Actions get a static `PATH` and no client `PATH` or `LD_LIBRARY_PATH`; `--action_env=NAME` or `NAME=VALUE` adds a variable. https://bazel.build/docs/user-manual · https://github.com/bazelbuild/bazel/issues/6648
  - The default flipped to `true` in 0.21, then back to `false` on 2019-01-18: "it breaks local execution users". https://github.com/bazelbuild/bazel/commit/9137fb940886aa516f32ca8a36feccedb545c99b
  - `/usr/local/bin` joined the static `PATH` in 2019 so Python 3 on a Mac was found. https://github.com/bazelbuild/bazel/commit/3a4be3c93813987a27a97dade3f9ebbc5770e349
  - The default flipped to `true` again for Bazel 9.0 (commit 2025-11-13; in 9.0.0rc3). https://github.com/bazelbuild/bazel/commit/e697ff774eff6c8a708fffca6fd8eeeb7f468bfe
  - On 2026-04-13 `/usr/local/bin` left the static `PATH` again and `/sbin` joined it (PR #29257). Which release carries it: UNVERIFIED. https://github.com/bazelbuild/bazel/commit/3e10e0fbb915e3db5d9ec26f548f79a04308ce0d
- **Deno: `--allow-env` guards the program, not its children.** `--allow-env=HOME,FOO` limits what Deno code reads; suffix wildcards since Deno 2.1; `--deny-env`, `--ignore-env`. A subprocess "can access system resources regardless of the permissions you granted". https://docs.deno.com/runtime/reference/permissions/
  - A child inherits the environment; `Deno.Command`'s `env` adds to it. `clearEnv: true` passes only `env`, and "even `PATH` is gone". https://docs.deno.com/examples/subprocess_env_cwd/ · https://docs.deno.com/api/deno/subprocess/
  - Spawning with an `LD_*` or `DYLD_*` variable needs the unscoped `--allow-run`. (permissions page)
- **Renovate: an allowlist that names proxies and certificates.** Children get only `basicEnvVars` (38 names), and Renovate sets `CI=true`. The list: `HOME`, `PATH`, `LANG`, `LC_ALL`, `HTTP_PROXY`, `http_proxy`, `HTTPS_PROXY`, `https_proxy`, `NO_PROXY`, `no_proxy`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_DIR`, `SSL_CERT_FILE`, `GIT_SSL_CAINFO`, `GIT_SSL_CAPATH`, `DOCKER_*` (3), `COREPACK_*` (12, `COREPACK_NPM_TOKEN` among them), `PNPM_*` (2) and Windows names. More through `customEnvVariables`, `allowedEnv`, or `exposeAllEnv` (default `false`). The reason given: an "insider attack" and an "outsider attack from a malicious dependency". https://docs.renovatebot.com/environment-variable-handling/ · https://docs.renovatebot.com/self-hosted-configuration/#exposeallenv
- **Codex (rust-v0.163.0, 2026-10-15): both forms.** `shell_environment_policy.inherit` is `all` (default), `core` or `none`. The name deny list (`*KEY*`, `*SECRET*`, `*TOKEN*`, any case) applies only when `ignore_default_excludes = false`; the default is `true`, so by default Codex passes everything. Order: inherit, default excludes, custom excludes, `set`, include-only. https://learn.chatgpt.com/docs/config-file/config-advanced · https://github.com/openai/codex/blob/main/codex-rs/protocol/src/shell_environment.rs · https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs
- **Claude Code: a deny list of named variables.** `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips "Anthropic and cloud provider credentials" from the Bash tool, hooks and MCP stdio servers (release notes v2.1.83, 2026-03-25). https://github.com/anthropics/claude-code/releases/tag/v2.1.83
  - claude-code-action v1.0.77 (2026-03-23) turns it on for workflows that take untrusted input; its notes name Claude Code v2.1.79 or later. It strips "Anthropic auth tokens, cloud provider credentials, GitHub Actions OIDC and runtime tokens, OTEL auth headers", and keeps `GITHUB_TOKEN` and `GH_TOKEN` "so wrapper scripts can still call the GitHub API". https://github.com/anthropics/claude-code-action/releases/tag/v1.0.77
  - In 2.1.251 the list grew to config pointers (`KUBECONFIG`, `AWS_SHARED_CREDENTIALS_FILE`, `DOCKER_CONFIG`, `GNUPGHOME`, `SSH_AUTH_SOCK`, `CLAUDE_CONFIG_DIR` and others). Stripping `CLAUDE_CONFIG_DIR` sent hooks to the wrong config folder, and they "still exit zero". The issue is open. https://github.com/anthropics/claude-code/issues/91020 (2026-08-31)

### Allowlist against deny list by name

- **An allowlist breaks a tool that needs a variable the list lacks.** Seen in this research: Bazel's 2019 rollback; Turborepo's later additions; gh exits 4 without `HOME`; gemini and npm exit 127 when `PATH` lacks `node`; agy exits 1 without `HOME`; git without `HOME` loses the gh credential helper and prompts on `/dev/tty`. Codex's `core` set and Turborepo's list hold no proxy or certificate variable; Renovate's holds both cases of each proxy variable and five certificate variables.
- **An allowlist hides an unknown secret name.** A deny list passes it.
- **A deny list by name misses secrets in other names.** The rule `/TOKEN|SECRET|KEY|PASSWORD/i` does not match `DATABASE_URL` or `SENTRY_DSN`, which often hold credentials inside a URL (a property of the pattern, not a measured case).
- **A deny list by name also catches what a tool needs.** npm trusted publishing reads `ACTIONS_ID_TOKEN_REQUEST_TOKEN`; a private-registry `bun install` reads `NPM_CONFIG_TOKEN` or `BUN_CONFIG_TOKEN`; gh in CI reads `GH_TOKEN`. Each needs a pass-through. It also catches non-secrets: `MAX_MCP_OUTPUT_TOKENS` here.
- **Neither form hides secrets kept in files.** Every list in this section keeps `HOME`, so a child still reads `~/.npmrc`, gh's config and keychain login, and in CI the token that `actions/checkout` wrote into `.git/config`.
- **The deny list can share the redaction rule.** `redactorFor` already uses this name pattern, so one rule would decide both what leaves the CLI's output and what a child gets.

## 6. Prior art: time limits and output caps

| Tool | Default time limit | Default output cap | How it stops the program | Source |
|---|---|---|---|---|
| Node `child_process.exec`, `execFile` (v26.12.0 docs) | `timeout: 0` (none) | `maxBuffer: 1024 * 1024` per stdout or stderr; "the child process is terminated and any output is truncated" | `killSignal` SIGTERM | https://nodejs.org/api/child_process.html |
| Node `spawn` | `timeout: undefined` (added v15.13.0) | none | SIGTERM | same |
| Node `spawnSync` | `undefined` | `1024 * 1024` | SIGTERM | same |
| execa (main) | `timeout: 0` | `maxBuffer: 100_000_000` per stream | SIGTERM, then SIGKILL after `forceKillAfterDelay: 5000`; `killDescendants: false`; error flags `timedOut`, `isMaxBuffer`, `isForcefullyTerminated`; `extendEnv: true` | https://github.com/sindresorhus/execa/blob/main/docs/api.md |
| Renovate | `executionTimeout: 15` minutes | 10 MiB per stream | process group (`detached`, `kill(-pid)`), SIGTERM | https://github.com/renovatebot/renovate/blob/main/lib/util/exec/index.ts · https://github.com/renovatebot/renovate/blob/main/lib/config/options/index.ts |
| Claude Code Bash tool | `BASH_DEFAULT_TIMEOUT_MS` 120000 (2 min); ceiling `BASH_MAX_TIMEOUT_MS` 600000 (10 min) | `BASH_MAX_OUTPUT_LENGTH` 30000 characters (maximum 150000) | | https://code.claude.com/docs/en/env-vars |
| Claude Code API requests | `API_TIMEOUT_MS` 600000 to response headers; `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS` 120000 for a marketplace clone | | | same; https://code.claude.com/docs/en/network-config |
| Bazel console output | | `--experimental_ui_max_stdouterr_bytes` 1048576 | | https://bazel.build/versions/8.7.0/reference/command-line-reference |
| gh (trunk, 2026-10-20) | none: `NewHTTPClient` sets no `Timeout`; go-gh `ClientOptions.Timeout` "Default is no timeout" | | | https://github.com/cli/cli/blob/trunk/api/http_client.go · https://pkg.go.dev/github.com/cli/go-gh/v2/pkg/api#ClientOptions |
| Go `http.Client` | "A Timeout of zero means no timeout" | | | https://pkg.go.dev/net/http#Client |
| git over HTTP | no overall limit in the docs; `http.lowSpeedLimit` with `http.lowSpeedTime` (`GIT_HTTP_LOW_SPEED_LIMIT`, `GIT_HTTP_LOW_SPEED_TIME`) aborts a slow transfer; no default given | | | https://git-scm.com/docs/git-config#Documentation/git-config.txt-httplowSpeedLimit |
| npm | `fetch-timeout` 300000 (5 min); `fetch-retries` 2; `fetch-retry-maxtimeout` 60000 | | | https://docs.npmjs.com/cli/v11/using-npm/config |
| Octokit `request.js` | none; use `request.signal`. The Node-only `request.timeout` (0 = off) left between v6.2.8 and v8.4.1 (2023) | | | https://github.com/octokit/request.js/blob/main/README.md · https://github.com/octokit/request.js/compare/v6.2.8...v8.4.1 |
| Bun `fetch` | none seen within 3 s (section 3) | | | probe |
| GitHub Actions | job `timeout-minutes` default 360; a step has no default | | the runner cancels the job | https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes |

## 7. Measurements on this Mac

Three runs each, on 2026-10-20, home network, warm caches. Sizes only; no output is kept.

| Command line | Run 1 | Run 2 | Run 3 | stdout | stderr |
|---|---|---|---|---|---|
| `gh api user --jq .login` | 355 ms | 313 ms | 342 ms | 13 B | 0 B |
| `gh api rate_limit` | 285 ms | 351 ms | 303 ms | 1,233 B | 0 B |
| `git ls-remote https://github.com/acmelabs-15/cli.git` | 297 ms | 269 ms | 249 ms | 472 B | 0 B |
| `claude plugin validate . --strict` (in brain) | 452 ms | 436 ms | 477 ms | 428 B | 0 B |
| `agy plugin validate .` (in brain) | 74 ms | 63 ms | 62 ms | 283 B | 0 B |
| `gemini extensions validate .` (in brain) | 980 ms | 914 ms | 905 ms | 0 B | 45 B |
| `bun install --frozen-lockfile` (fresh local clone of this repo, warm cache, `node_modules` removed each run) | 155 ms | 100 ms | 92 ms | 197 B, 196 B, 196 B | 0 B |
| `gh run view <latest successful brain run> --log` | 2,825 ms | 1,122 ms | 1,461 ms | 43,931 B | |

- Every call ended in under 3 s. The largest output was 43,931 B, a CI log.
- A 1 MiB cap is about 24 times the largest output measured; 10 MiB is about 239 times.
- A cold-cache `bun install` and a CI runner's network were not measured.

## 8. Options

### Question 21: which variables an outside program gets

| Option | What a child gets | What it protects | What it breaks or costs | Prior art |
|---|---|---|---|---|
| A. No change | The CLI's whole environment at launch | Nothing | In CI a validator, or a script that a hostile pull request adds and `bun` runs, sees `GH_TOKEN`, `NPM_TOKEN`, `NODE_AUTH_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` when the job sets them | Node, execa (`extendEnv: true`), Bun, Deno children, Codex default |
| B. Deny list by name, the redaction rule's pattern, with a per-call pass-through by name | Everything except names matching `/TOKEN\|SECRET\|KEY\|PASSWORD/i`; a call names what it needs back, such as `GH_TOKEN` for gh in CI or `ACTIONS_ID_TOKEN_REQUEST_TOKEN` for an npm publish | The usual secret names; one rule for output and children | Misses secrets in other names (`DATABASE_URL`); hits non-secrets (`MAX_MCP_OUTPUT_TOKENS`); proxies, certificates, `HOME` and `PATH` keep working; file-held secrets stay readable | Codex default excludes (opt-in); Claude Code's scrub (named list, issue #91020) |
| C. Small allowlist, with per-call additions | Only a base set such as Codex's `core` (11 names) | Every unlisted secret, including unknown names | Drops proxies and certificates, so a user behind a corporate proxy breaks; drops `XDG_CONFIG_HOME`, `GH_CONFIG_DIR`, `CI`, gh's agent-detection names; each later need is a code change | Codex `core`; Bazel strict action env (rolled back once in 2019); Deno `clearEnv` |
| D. Wide allowlist with proxies and certificates, with per-call additions | A base set such as Renovate's 38 names plus `CI` | As C, while proxies and certificates keep working | A list to keep current, as Turborepo's growth shows; still drops unlisted needs; file-held secrets stay readable | Renovate `basicEnvVars`; Turborepo built-in list (no proxies) |

Facts that bear on every option:

- Bun's `env` replaces the environment (section 2), so B, C and D each mean building the child's `env` object in `realWorld().spawn`. When the object lacks `PATH`, Bun still finds the program but the child has no `PATH`, which breaks gemini and npm (exit 127).
- `SpawnOptions` today is `{ cwd, stdin, signal }`. A pass-through list would be a new field. `fakeWorld` logs every option except `signal`, so a new field shows in the call log that tests check.
- CI may run the npm CLI for the publish step (ADR-0006), possibly as `bunx npm@12` (open question 9). A trusted publish reads the `ACTIONS_ID_TOKEN_REQUEST_*` pair, so option B needs a pass-through there.
- gh reports a missing `HOME` as "please run: gh auth login" with exit 4, its "authentication required" code. A list that drops `HOME` would therefore surface as a false "a login is needed" (failure kind `login`, exit 4), not as a missing variable.

### Question 22: a byte cap and a default time limit

| Option | What happens | What it protects | What it breaks or costs | Numbers from prior art |
|---|---|---|---|---|
| A. No change | Output read whole into memory; no time limit; a cancel kills the direct child only | Nothing new | A flood costs memory (200 MiB of output took 599 MiB here); a stall lasts until CI's 360-minute job limit; a grandchild keeps the CLI alive after a cancel (10 s in the probe) | Node `spawn`, execa, gh, Go, Octokit, Bun `fetch`: no default limit |
| B. A default time limit per program and per request, which a call can override | A program: its own process group (`detached`), `kill(-pid)` with SIGTERM, then SIGKILL after a grace period, and the call fails as `outside` (exit 3). A request: `AbortSignal.any([runSignal, AbortSignal.timeout(ms)])`; `TimeoutError` maps to `outside`, the cancel to `cancelled` | Stalls: a hung network, a `/dev/tty` prompt, a hostile script that sleeps | A slow but healthy call fails unless the call raises its limit; a value to choose; a detached group does not get the terminal's Ctrl+C (UNVERIFIED) and outlives a SIGKILL of the CLI | 2 min (Claude Code Bash, default), 5 min (npm fetch), 10 min (Claude Code ceiling, API), 15 min (Renovate); grace 5 s (execa). Measured here: every call under 3 s |
| C. A byte cap per output stream that stops the program | A reader counts bytes; past the cap it kills the group and the call fails as `outside`. For `fetch`: a reader that counts body bytes; `Content-Length` can only reject early | Floods; memory | A large but healthy output fails unless the call raises its cap; the partial output is dropped or marked | 1 MiB (Node `exec`, `spawnSync`; Bazel console), 10 MiB (Renovate), 100,000,000 B (execa), 30,000 characters (Claude Code Bash). Measured largest here: 43,931 B |
| D. Bun's built-in `timeout`, `killSignal` and `maxBuffer` only | The fewest lines of code | Part of B and C for a program with no children | No group kill, so pipes stay open (10 s in the probes); no field that tells a time-out or an overflow from another SIGTERM; `maxBuffer` overshoots (49,140 B for a 1,000 B cap) and its docs cover `spawnSync` only | none |

Facts that bear on every option:

- B and C combine; neither needs the other.
- A prompt on `/dev/tty` is a stall that no byte cap catches. Three guards exist: `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT_DISABLED`, and `detached: true` (no controlling terminal). The first two are environment variables, so they touch question 21 as well.
- `kill(-pgid)` throws `ESRCH` when the group is already gone; Bun's own test fix ignores that case. https://github.com/oven-sh/bun/pull/43438

## Gaps

| Open point | The probe or source that would settle it |
|---|---|
| Every probe ran on macOS. `timeout`, `maxBuffer`, `detached` and the group kill on Linux (the CI runners) are UNVERIFIED. | Run the `limits-probe` scripts in an `ubuntu-latest` job. |
| Whether Bun's `fetch` has a default time limit longer than 3 s. | A raw socket that accepts and never answers; a `fetch` with no signal; record when it ends, up to 15 minutes. |
| Which git process held stderr after git was killed. | During the stall, `ps -o pid,ppid,pgid,command` under the same pseudo-terminal setup. |
| Whether Ctrl+C reaches a detached child, and what the CLI must do. | In a pseudo-terminal, start a detached `sleep` through the CLI, send `\x03`, check the group with `ps`. |
| Whether `claude plugin validate`, `gemini extensions validate` and `agy plugin validate` use the network. | Run each with `HTTPS_PROXY=http://127.0.0.1:9` (a dead proxy) and compare the result. |
| The proxy and certificate variables of Gemini CLI and agy. | Run each through a local logging proxy, and read their source or docs. |
| Whether `bun install` on 1.4.0 honours `NODE_EXTRA_CA_CERTS`; the reports conflict. | A local HTTPS registry with a self-signed CA, as in https://github.com/oven-sh/bun/issues/17325. |
| Whether npm 12 keeps the npm 11 values in section 4 and 6. | `bunx npm@12 config ls -l` and its docs. |
| The variables a trusted publish needs under `bunx npm@12`, which a deny list would hit. | The probe of open question 9, in the `shared-workflows` spec. |
| The time and size of a cold-cache `bun install`, and of the calls on a CI runner. | Repeat section 7 in an Actions job. |
| Which Bazel release carries PR #29257; the state of Claude Code issue #91020 after 2026-10-20. | The Bazel release notes; the issue page. |
| Windows (`PATHEXT`, `SYSTEMROOT`, `APPDATA`) is not covered. | A probe on a Windows runner, if the CLI is to run there. |
| Glossary: `CONTEXT.md` has no entry for outside program, time limit, byte cap, allowlist or deny list. | Raise them through the domain-modeling skill when the `github-ops` spec uses them. |
