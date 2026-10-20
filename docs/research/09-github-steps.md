# GitHub steps: gh, the REST API, timing and push

What this is: research for the `github-ops` module spec: the gh CLI, the REST endpoints for a new repo, the Actions setting, the "Protect main" ruleset, pull requests and workflow runs, timing and rate limits, push authentication, and how acmelabs-15/cli was created. Researched on 2026-10-20 by a research agent of the spec session, read-only: `gh` GET calls, gh 2.98.0's own help, gh's source at tag `v2.98.0` (and `v2.102.0` where noted), the docs.github.com article API, and Exa. The docs.github.com pages show no page dates; they default to REST API version `2026-03-10`. No call created, changed or deleted anything on GitHub.

## 1. The gh CLI

### 1.1 Versions

- **Installed:** `gh version 2.98.0 (2026-08-20)`, from Homebrew (`/opt/homebrew/bin/gh`). (`gh --version`)
- **Latest release:** v2.102.0, published 2026-09-30. The releases in between: v2.101.0 (2026-09-15), v2.100.0 (2026-09-03), v2.99.0 (2026-09-01). https://github.com/cli/cli/releases/tag/v2.102.0
- `git/client.go` is the same in v2.98.0 and v2.102.0, except for new worktree helpers. The credential-helper code (1.5) did not change. https://github.com/cli/cli/blob/v2.102.0/git/client.go
- gh checks for a new release once every 24 hours and prints the notice on stderr. `GH_NO_UPDATE_NOTIFIER` turns it off. (`gh help environment`)
- gh 2.98.0 has telemetry. Local config shows `telemetry=enabled`. `GH_TELEMETRY=false` or `DO_NOT_TRACK=1` turns it off. (`gh help environment`, `gh config list`)
- gh 2.98.0 detects an AI agent from environment variables (Claude Code, Codex, Gemini CLI, Antigravity and others) and appends `Agent/<name>` to its User-Agent header. https://github.com/cli/cli/blob/v2.98.0/internal/agents/detect.go · https://github.com/cli/cli/blob/v2.98.0/api/http_client.go

### 1.2 `gh api`

- **Token order:** `GH_TOKEN`, then `GITHUB_TOKEN`, then `oauth_token` in `hosts.yml`, then the system keyring for the active account. For a GitHub Enterprise Server host the variables are `GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN`. https://github.com/cli/go-gh/blob/v2.13.0/pkg/auth/auth.go (`tokenForHost`) · https://github.com/cli/cli/blob/v2.98.0/internal/config/config.go (`ActiveToken`) · `gh help environment`
- gh 2.98.0 pins go-gh v2.13.0. (`go.mod` at `v2.98.0`)
- **Header:** gh sends `Authorization: token <token>`. A `-H "Authorization: ..."` from the caller wins, because gh sets the header only when it is empty. https://github.com/cli/cli/blob/v2.98.0/api/http_client.go (`AddAuthTokenHeader`)
- **An HTTP error (status 300 or more):**
  - The JSON error body goes to stdout, unchanged. With `--jq` or `--template`, gh skips the filter and prints the raw error body. (Probe: `gh api repos/acmelabs-15/cli/git/ref/tags/latest --jq .object.sha` printed `{"message":"Not Found",...,"status":"404"}`.)
  - stderr gets one line: `gh: <message> (HTTP <code>)`. When the body's `errors` field is a string, the line is `gh: <errors> (<message>)`. When the body has no message, the line is `gh: HTTP <code>`.
  - When the response has `X-Accepted-OAuth-Scopes` that the token lacks, stderr gets a second line, for example: `gh: This API operation needs the "admin:org" scope. To request it, run:  gh auth refresh -h github.com -s admin:org`.
  - The exit code is 1.
  - https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/api/api.go (`processResponse`, `parseErrorResponse`, lines 473-569 and 651-719)
- **The error body carries `status` as a string**, for example `"status":"404"`. (All probes in section 2.)
- **A 422's cause is only in the body.** With a `message`, gh's stderr line leaves out a list of `errors`, so a 422 shows `gh: Validation Failed (HTTP 422)`, and its cause, such as `No commits between main and add-brain`, is only in `errors[].message`. gh reads `errors` as one text, or as a list of texts and of objects with a `message` (`parseErrorResponse` in api.go at v2.98.0). (Added by the github-ops login-message slice, 2026-10-20.)
- **A 401 from a bad token:** `gh api user` with `GH_TOKEN=not-a-real-token` printed the body `{"message":"Bad credentials",...,"status":"401"}` to stdout and `gh: Bad credentials (HTTP 401)` to stderr, exit 1. (Probe, 2026-10-20.)
- **A 304:** a conditional GET that returns `304 Not Modified` makes `gh api` exit 1 with `gh: HTTP 304` on stderr. The caller must read the status line (`-i`) to tell "unchanged" from a failure. (Probe on `repos/acmelabs-15/cli/actions/runs?per_page=2` with `-H "If-None-Match: <etag>"`.)
- **`-i, --include`:** prints the status line (for example `HTTP/2.0 403 Forbidden`), then the headers sorted by name, each ending in CRLF, then a blank CRLF line, then the body. All of it goes to stdout. (`gh api --help`; api.go `printHeaders`)
- **`--paginate`:** follows the `Link` header until no next page is left, and adds `per_page=100` to a REST path. Each page prints as its own JSON array or object; `--slurp` wraps all pages in one outer array. (`gh api --help`; api.go lines 354-366)
- **`--input -`:** reads the request body from stdin. A body switches the default method to POST; `-X` overrides it. With `--input`, any `-f`/`-F` fields go to the query string. (`gh api --help`; api.go lines 325-380) acmelabs-15/cli's ruleset was created this way (section 5).
- **`-H "X-GitHub-Api-Version: ..."`:** works. `gh api -i -H "X-GitHub-Api-Version: 2026-03-10" repos/acmelabs-15/cli` returned `X-Github-Api-Version-Selected: 2026-03-10`. Without the header, gh sends no version, and every probe returned `X-Github-Api-Version-Selected: 2022-11-28`. An unknown version (`2020-01-01`) returned HTTP 400 with `"errors":"The version you specified in the \"X-GitHub-API-Version\" request header, \"2020-01-01\", is not a supported version. The following versions are currently supported: \"2026-03-10\" (most recent) and \"2022-11-28\"."`.
- **No terminal:** every probe in this note ran with no terminal. `gh api` starts a pager only when stdout is a terminal, and uses colour only on a terminal. `GH_PROMPT_DISABLED` turns off prompts. (api.go lines 329-335; `gh help environment`)
- **`--cache <duration>`** caches a response on disk; it is off by default. (`gh api --help`)

### 1.3 Exit codes

`gh help exit-codes` in gh 2.98.0 says, exactly:

> - If a command completes successfully, the exit code will be 0
> - If a command fails for any reason, the exit code will be 1
> - If a command is running but gets cancelled, the exit code will be 2
> - If a command requires authentication, the exit code will be 4
>
> NOTE: It is possible that a particular command may have more exit codes, so it is a good practice to check documentation for the command if you are relying on exit codes to control some behavior.

From the source, https://github.com/cli/cli/blob/v2.98.0/internal/ghcmd/cmd.go (lines 42-49 and 194-247):

- The code also defines `exitPending = 8`, which the help text does not list.
- Exit 4 comes only from the check before a command runs: no token at all for the host. https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/root/root.go (lines 83-93)
- Probe with an empty `GH_CONFIG_DIR`: `gh api user` printed `To get started with GitHub CLI, please run:  gh auth login` and `Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.`, exit 4.
- A token that GitHub rejects (401) gives exit 1, not 4 (1.2).
- A flag error, for example `gh run watch` with no run id and no terminal, gives exit 1 and prints the usage text.
- An extension's or alias's exit code passes through unchanged.

### 1.4 `gh auth status`

- **Logged in:** exit 0. (Probe.)
- **Logged out:** prints `You are not logged into any GitHub hosts. To log in, run: gh auth login` on stderr, exit 1. (Probe with an empty `GH_CONFIG_DIR`.)
- **A token that GitHub rejects:** prints `X Failed to log in to github.com using token (GH_TOKEN)` and `The token in GH_TOKEN is invalid.`, exit 1. (Probe.)
- **`--json hosts`:** present in 2.98.0. With `--json`, the command always exits 0 unless a fatal error occurs. Logged out, it printed `{"hosts":{}}`. (`gh auth status --help`; status.go lines 149-150, 206-223)
- **JSON fields per account:** `active`, `gitProtocol`, `host`, `login`, `scopes`, `state` (`success`, `timeout` or `error`), `tokenSource`, and `error` when the state is `error`. The `token` field appears only with `--show-token`. https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/auth/status/status.go (lines 25-38)
- **This machine** (`gh auth status --json hosts`, token removed): `{"active":true,"gitProtocol":"https","host":"github.com","login":"loriensleafs","scopes":"admin:public_key, gist, read:org, repo, workflow","state":"success","tokenSource":"keyring"}`. In text mode the token line shows only `gho_` and asterisks.
- **The answer's shape:** `{"hosts":{"<host>":[account, ...]}}`, the active account first. `scopes` and `error` are left out when empty, and the token is dropped without `--show-token` (`authEntry` and `statusRun` in status.go at v2.98.0). (Added by github-ops task 6, 2026-10-20.)
- **The states:** `timeout` only when gh's request to GitHub times out (`net.Error.Timeout()`); `error` for every other failure, a 401 and a DNS failure alike (`buildEntry` in status.go).
- **The `error` text** (from source; not probed for a keyring token): for a keyring token, go-gh's `HTTPError` text for gh's GET of the API root, such as `HTTP 401: Bad credentials (https://api.github.com/)`, which can hold a second line (`GetScopes` in oauth_scopes.go; `errors.go` at go-gh v2.13.0). For a token from a variable, the text of gh's query for the login name, such as the probe's `non-200 OK status code: 401 Unauthorized body: "..."` (181 characters). Neither holds the token, which gh sends in a header.
- **Logged out, with `--json`** (probe, 2026-10-20, empty `GH_CONFIG_DIR`): stdout `{"hosts":{}}`, stderr `You are not logged into any GitHub hosts. To log in, run: gh auth login`, exit 0.
- **A rejected `GH_TOKEN` beside a keyring login** (probe, 2026-10-20): two accounts, exit 0. The active one is `{"state":"error","error":"non-200 OK status code: 401 Unauthorized body: ...","active":true,"host":"github.com","login":"","tokenSource":"GH_TOKEN","gitProtocol":"https"}`; the keyring account follows with `"active":false` and `"state":"success"`.
- **`gh auth login` and `gh auth refresh` refuse to run** while `GH_TOKEN` or `GITHUB_TOKEN` is set. They print `The value of the GH_TOKEN environment variable is being used for authentication.` and exit 1 (`login.go` line 189 and `refresh.go` line 169 at v2.98.0).
- **How scopes show:** the text line `Token scopes: 'admin:public_key', 'gist', ...` appears only for tokens that start with `ghp_` (classic PAT) or `gho_` (OAuth app token). gh reads the scopes from the `X-OAuth-Scopes` header of a GET to the API root. When it is missing `repo` or `read:org`, the text adds `Missing required token scopes`. https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/auth/status/status.go (lines 73-83, 358-360) · https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/auth/shared/oauth_scopes.go (lines 36-110)
- **Reading scopes another way:** `gh api -i user` returns `X-Oauth-Scopes: admin:public_key, gist, read:org, repo, workflow` and `X-Accepted-Oauth-Scopes:` (empty for that endpoint). `X-OAuth-Scopes` lists the scopes the token has; `X-Accepted-OAuth-Scopes` lists the scopes the action checks for. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- **Fine-grained PATs and GitHub App tokens:** these have permissions, not scopes. gh's code treats an empty scopes header as an integration token and skips the scope check ("if the token reports no scopes, assume that it's an integration token"). That such tokens return no `X-OAuth-Scopes` header is UNVERIFIED by a probe. For them, GitHub returns `X-Accepted-GitHub-Permissions`, for example `contents=read`, to name what an endpoint needs. https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#resource-not-accessible
- `gh run watch` does not support fine-grained PATs, because such a PAT cannot get `checks:read`. (`gh run watch --help`)

### 1.5 How gh's git calls authenticate

- `AuthenticatedCommand` in https://github.com/cli/cli/blob/v2.98.0/git/client.go (lines 140-162) builds the helper string with `fmt.Sprintf("!%q auth git-credential", c.GhPath)`, so the value is `!"<path to gh>" auth git-credential`. `GhPath` defaults to `gh`.
- For `Fetch`, `Pull` and `Push` (pattern `AllMatchingCredentialsPattern`), it prepends exactly:
  `-c credential.helper=` `-c credential.helper=!"<gh path>" auth git-credential`
- For `Clone` (a pattern from the clone URL's host), it prepends:
  `-c credential.https://github.com.helper=` `-c credential.https://github.com.helper=!"<gh path>" auth git-credential`
  The pattern comes from `ghinstance.HostPrefix`, which returns `https://<host>/`, with the trailing `/` removed. https://github.com/cli/cli/blob/v2.98.0/internal/ghinstance/host.go
- The first, empty `-c ...helper=` clears any helper set in git config, so only gh's helper runs. The source comments call the all-hosts pattern "less secure" and plan to remove it.
- `Push` runs `git push --set-upstream <remote> <ref>` through `AuthenticatedCommand` (client.go lines 848-858).
- **`gh auth git-credential`:** "Implements git credential helper protocol". It serves the token of the gh login. (`gh auth git-credential --help`)
- **`gh auth setup-git`:** writes gh as the credential helper into the user's git config, for all authenticated hosts or one `--hostname`. It fails when no host is authenticated. (`gh auth setup-git --help`)
- **This machine** already has it: `~/.gitconfig` sets `credential.https://github.com.helper` to empty, then to `!/opt/homebrew/bin/gh auth git-credential`, and the same for `https://gist.github.com`. Xcode's system gitconfig also sets `credential.helper osxkeychain`. git is 2.54.0 (Apple Git-157). (`git config --show-origin --get-regexp '^credential\.'`)

### 1.6 `gh repo create`

- **Non-interactive flags:** a name, and one of `--public`, `--private` or `--internal`. With no terminal and no visibility flag, it fails with "`--public`, `--private`, or `--internal` required when not running interactively". (`gh repo create --help`; create.go lines 126-133)
- **Org repo:** pass `OWNER/REPO`, for example `acmelabs-15/<name>`. Without `OWNER/`, the owner is the logged-in user.
- **`--source <dir>`:** creates the repo from a local repo. `--remote <name>` names the new remote (default `origin`). `--push` pushes local commits. `--remote` and `--push` work only with `--source`. `--source` does not work with `--clone`, `--template`, `--license` or `--gitignore`. `--push` with no commits fails: "`--push` enabled but no commits found in <path>". (create.go lines 150-163, 557-592)
- **The API call:** with no template, licence, gitignore or README, gh uses the GraphQL `createRepository` mutation, not REST. With a licence, gitignore or README, it uses `POST /orgs/{org}/repos` (or `POST /user/repos`). https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/repo/create/http.go (lines 77-260)
- **The remote URL** comes from gh's `git_protocol` config. This machine has `git_protocol=https`, so the remote is `https://github.com/<owner>/<repo>.git`. (create.go lines 645-646; `gh config get git_protocol`)
- **The push:** `git push --set-upstream <remote> HEAD`, through gh's credential helper (1.5). (create.go lines 681-690)
- **Output with no terminal:** one line on stdout, the repo URL, for example `https://github.com/acmelabs-15/cli`. With a terminal it prints `✓ Created repository <owner/repo> on <host>`, the URL, `✓ Added remote <url>` and `✓ Pushed commits to <url>`. (create.go lines 634-643, 687-688, 746-747; section 5)
- **No `--json`** flag. (`gh repo create --help`)
- gh retries a clone of a just-created repo up to 3 times, 3 seconds apart, when git exits 128 (`cloneWithRetry`, used for `--clone` and template repos, not for `--source`). (create.go lines 709-734)

### 1.7 `gh pr create`

- **Flags:** `--base`, `--head`, `--title`, `--body`, `--body-file` (`-` reads stdin), `--fill`, `--fill-first`, `--fill-verbose`, `--draft`, `--label`, `--reviewer`, `--assignee`, `--milestone`, `--project`, `--no-maintainer-edit`, `--dry-run`, `--web`, `-R OWNER/REPO`. (`gh pr create --help`)
- **No `--json`** flag. On success it prints the PR URL on stdout. (`gh pr create --help`; create.go line 1069)
- **No terminal:** it needs `--title` and `--body` (or a `--fill` flag): "must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively". (create.go line 327)
- **No terminal, branch not pushed, no `--head`:** it prints `aborted: you must first push the current branch to a remote, or use the --head flag` and exits 1. (create.go lines 950-952)
- **An open PR for the same head and base:** it fails with `a pull request for branch "<head>" into branch "<base>" already exists:` and the URL. (create.go lines 471-483)

### 1.8 `gh run watch`, `gh run list`, `gh run view`

- **`gh run watch <run-id>`:** flags `--exit-status`, `--compact`, `-i, --interval` (default 3 seconds). No `--json`. (`gh run watch --help`)
- **No terminal:** the run id is required. Without it: `run ID required when not running interactively`, exit 1. (Probe; watch.go line 76)
- **Each refresh** GETs the run, then its jobs, then the annotations of each job until that job ends. It still writes the whole render to stdout at each refresh with no terminal. The final `completed with '<conclusion>'` line prints only on a terminal. (watch.go lines 150-201, 215-262)
- **`--exit-status`:** exit 1 when the conclusion is not `success`. A run that has already completed prints `Run <name> (<id>) has already completed with '<conclusion>'` and exits at once. (watch.go lines 139-145, 207-209)
- **Cost (derived from the source, not measured):** at the default 3 seconds, at least 2 GETs per refresh, so at least 2,400 requests per hour, against a 5,000-per-hour limit (3.3).
- **`gh run list --json <fields>`:** fields `attempt`, `conclusion`, `createdAt`, `databaseId`, `displayTitle`, `event`, `headBranch`, `headSha`, `name`, `number`, `startedAt`, `status`, `updatedAt`, `url`, `workflowDatabaseId`, `workflowName`. Filters: `--branch`, `--commit <sha>`, `--event`, `--status`, `--workflow`, `--user`, `--created`, `-L` (default 20). It works with no terminal. (`gh run list --help`; probe on acmelabs-15/brain)
- **`gh run view`:** has `--json` (the same fields plus `jobs`) and `--exit-status`. (`gh run view --help`)

### 1.9 This machine's login

- Account `loriensleafs` on github.com, token from the keyring, git protocol `https`.
- Scopes: `admin:public_key`, `gist`, `read:org`, `repo`, `workflow`. `workflow` is present. `admin:org` is not.
- `loriensleafs` is an **admin** (owner) of acmelabs-15, state `active`. (`gh api user/memberships/orgs/acmelabs-15`)
- `GH_TOKEN`, `GITHUB_TOKEN`, `GH_HOST`, `GH_REPO` and `GH_PROMPT_DISABLED` are unset in this shell.

## 2. The REST API

### 2.1 API versions

- Supported versions: `2026-03-10` (end of support "Not yet scheduled") and `2022-11-28` (end of support March 10, 2028). `gh api versions` returned `["2026-03-10","2022-11-28"]`. https://docs.github.com/en/rest/about-the-rest-api/api-versions
- A request with no `X-GitHub-Api-Version` header uses `2022-11-28`. An old version stays supported for at least 24 months after a newer one is released. Near the end, responses carry `Deprecation` and `Sunset` headers. After the end, a request that names that version gets `410 Gone`, and an unversioned request moves to the next oldest supported version.
- An unknown version gets `400 Bad Request` (1.2). https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
- **What `2026-03-10` changes for the endpoints in this note** (https://docs.github.com/en/rest/about-the-rest-api/breaking-changes):
  - Repository responses lose `has_downloads` and `use_squash_pr_title_as_default`. Probe: under `2026-03-10`, `GET repos/acmelabs-15/cli` returned `"has_downloads":null`; under `2022-11-28` it returned `false`.
  - `POST /orgs/{org}/repos` and `POST /user/repos` return `451` instead of `422` when trade controls block the creator.
  - Pull request responses lose `merge_commit_sha` and the singular `assignee`.
  - `GET /rate_limit` loses the top-level `rate`; read `resources.core`.
  - `POST .../actions/workflows/{id}/dispatches` returns `200` with the run details instead of `204`.
  - The `beta` media type is deprecated.
  - Nothing in the list touches the Actions workflow permissions, rulesets, the workflow runs list or git refs.

### 2.2 Endpoint table

Classic scope = what an OAuth app token or classic PAT needs. Fine-grained = the fine-grained PAT permission. Sources: each endpoint's reference page, and https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens. "Header" = the `X-Accepted-Oauth-Scopes` value seen on a GET probe.

| Step | Method and path | Success | Documented errors | Classic scope | Fine-grained |
|---|---|---|---|---|---|
| Create an org repo | `POST /orgs/{org}/repos` | 201 | 403, 422, 451 | `public_repo` or `repo` for public; `repo` for private | listed under Administration write and under Repository creation write, both marked "additional permissions"; which one suffices is UNVERIFIED |
| Get a repo | `GET /repos/{owner}/{repo}` | 200 | 301, 403, 404 | header: `repo` | Metadata read |
| Update a repo | `PATCH /repos/{owner}/{repo}` | 200 | 307, 403, 404, 422 | not stated on the page; UNVERIFIED (`repo` expected) | Administration write |
| Get the Actions setting | `GET /repos/{owner}/{repo}/actions/permissions/workflow` | 200 | none listed | `repo` | Administration read |
| Set the Actions setting | `PUT /repos/{owner}/{repo}/actions/permissions/workflow` | 204 | 409 | `repo` | Administration write |
| Org Actions setting | `GET`/`PUT /orgs/{org}/actions/permissions/workflow` | 200 / 204 | none listed | `admin:org` | Organization Administration read / write |
| List rulesets | `GET /repos/{owner}/{repo}/rulesets` | 200 | 404, 500 | header: `repo` | Metadata read |
| Get a ruleset | `GET /repos/{owner}/{repo}/rulesets/{ruleset_id}` | 200 | 404, 500 | header: `repo` | Metadata read |
| Create a ruleset | `POST /repos/{owner}/{repo}/rulesets` | 201 | 404, 422, 500 | not stated; UNVERIFIED (`repo` expected) | Administration write |
| Update a ruleset | `PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}` | 200 | 404, 422, 500 | not stated; UNVERIFIED | Administration write |
| Rules on a branch | `GET /repos/{owner}/{repo}/rules/branches/{branch}` | 200 | | | |
| Create a PR | `POST /repos/{owner}/{repo}/pulls` | 201 | 403, 422 | not stated; UNVERIFIED (`repo` or `public_repo` expected) | Pull requests write |
| List runs | `GET /repos/{owner}/{repo}/actions/runs` | 200 | none listed | `repo` for a private repo | Actions read |
| Get a run | `GET /repos/{owner}/{repo}/actions/runs/{run_id}` | 200 | none listed | `repo` for a private repo | Actions read |
| Get a ref | `GET /repos/{owner}/{repo}/git/ref/{ref}` | 200 | 404, 409 | header: `repo` | Contents read |

### 2.3 Create a repo in an organization

https://docs.github.com/en/rest/repos/repos#create-an-organization-repository

- "The authenticated user must be a member of the organization."
- Body fields: `name` (required), `description`, `homepage`, `private` (default false), `visibility` (`public` or `private`), `has_issues` (default true), `has_projects` (default true), `has_wiki` (default true), `has_downloads` (default true), `is_template` (default false), `team_id`, `auto_init` (default false: "Pass true to create an initial commit with empty README"), `gitignore_template`, `license_template` (for example `mit`), `allow_squash_merge`, `allow_merge_commit`, `allow_rebase_merge` (each default true), `allow_auto_merge` (default false), `delete_branch_on_merge` (default false; needs an org owner to set it true), `squash_merge_commit_title`, `squash_merge_commit_message`, `merge_commit_title`, `merge_commit_message`, `custom_properties`.
- The response carries `default_branch`, `clone_url` (for example `https://github.com/acmelabs-15/cli.git`), `ssh_url`, `html_url` and `visibility`.
- **Name taken:** 422 with `{"message":"Repository creation failed.","errors":[{"resource":"Repository","code":"custom","field":"name","message":"name already exists on this account"}]}`. Reported in several places; not probed here. https://stackoverflow.com/questions/65118407 · https://github.com/pulumi/pulumi-github/issues/757
- The 422 error codes (`missing`, `missing_field`, `invalid`, `already_exists`, `unprocessable`, `custom`) are listed at https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#validation-failed.

### 2.4 Get a repo, and change its visibility

- `PATCH /repos/{owner}/{repo}` takes `visibility` (`public` or `private`) or `private` (boolean). "You will get a 422 error if the organization restricts changing repository visibility to organization owners and a non-owner tries to change the value of private." https://docs.github.com/en/rest/repos/repos#update-a-repository
- The same PATCH also sets `has_issues`, `has_projects`, `has_wiki`, `allow_*_merge`, `delete_branch_on_merge`, `default_branch` and the other merge settings.
- Consequences listed by GitHub: private to public makes the code and the Actions history and logs visible to everyone, disables all push rulesets, and erases stars and watchers. Public to private erases stars and watchers and detaches public forks. https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- acmelabs-15 (`gh api orgs/acmelabs-15`): `members_can_create_repositories: true`, `members_can_create_public_repositories: true`, `members_can_create_private_repositories: true`, `members_can_create_internal_repositories: false`, `members_allowed_repository_creation_type: "all"`, `default_repository_permission: "read"`, `two_factor_requirement_enabled: false`, `web_commit_signoff_required: false`, plan `team` with 4 seats (3 filled), 13 public and 10 private repos.

### 2.5 The Actions setting

https://docs.github.com/en/rest/actions/permissions

- **Repo:** `GET` and `PUT /repos/{owner}/{repo}/actions/permissions/workflow`. Body: `default_workflow_permissions` (`read` or `write`) and `can_approve_pull_request_reviews` (boolean, "Enabling this can be a security risk"). PUT returns 204. "409 - Conflict response when changing a setting is prevented by the owning organization."
- **The 409 body text** is not documented and was not found. UNVERIFIED. One public setup script says the repo call fails with 409 unless the org allows the setting first. https://github.com/dwmkerr/claude-toolkit/blob/ccd03600cf85ee58fee7acb4672c002c4fe89aaa/plugins/dwmkerr/skills/project-setup/SKILL.md
- **The UI name** of `can_approve_pull_request_reviews` is "Allow GitHub Actions to create and approve pull requests". https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- **Org rules:** "If you select a restrictive option as the default in your organization settings, the same option is selected in the settings for repositories within your organization, and the permissive option is disabled." A new organization starts with workflows not allowed to create or approve PRs. https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization
- **A new org repo** inherits the setting: "If you create a new repository in an organization, the setting is inherited from what is configured in the organization settings." (repo settings page above)
- **Org endpoint:** `GET`/`PUT /orgs/{org}/actions/permissions/workflow`, which needs `admin:org`.
- **When the setting is off**, a workflow that opens a PR with `GITHUB_TOKEN` fails with "GitHub Actions is not permitted to create or approve pull requests." (Reported, https://github.com/onetimesecret/helm-chart/issues/90.)
- **Probes (2026-10-20):**
  - `repos/acmelabs-15/brain`, `.../cli` and `.../jev-gate` `/actions/permissions/workflow`: each `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}`.
  - `.../actions/permissions` on the same three: `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`.
  - Across all 23 acmelabs-15 repos: 22 return `read` with `can_approve_pull_request_reviews: true`; only `skills` (public, created 2026-05-20) returns `false`. `pinky`, a private repo created 2026-05-28 and never pushed, returns `true`. This suggests the org default is `read` with approval allowed. UNVERIFIED: the org endpoint is not readable (next bullet).
  - `orgs/acmelabs-15/actions/permissions` and `orgs/acmelabs-15/actions/permissions/workflow`: HTTP 403, `{"message":"You must be an org admin or have the actions policies fine-grained permission.",...,"status":"403"}`, with `X-Accepted-Oauth-Scopes: admin:org`. gh printed `gh: This API operation needs the "admin:org" scope. To request it, run:  gh auth refresh -h github.com -s admin:org`. The user is an org admin; the token lacks `admin:org`.
  - `orgs/acmelabs-15/rulesets`: HTTP 404 `Not Found`, with `X-Accepted-Oauth-Scopes: admin:org`. Whether the 404 comes from the missing scope or from the Team plan is UNVERIFIED.

### 2.6 Rulesets

https://docs.github.com/en/rest/repos/rules

- **Create:** `POST /repos/{owner}/{repo}/rulesets`, 201. Body: `name` (required), `target` (`branch`, `tag` or `push`; default `branch`), `enforcement` (required: `disabled`, `active` or `evaluate`; `evaluate` needs GitHub Enterprise), `bypass_actors` (array of `actor_id`, `actor_type`, `bypass_mode`), `conditions.ref_name.include` and `.exclude` (accepts `~DEFAULT_BRANCH` and `~ALL`), `rules` (array; `non_fast_forward` and `deletion` take only `type`).
- **Update:** `PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}`, 200, the same body.
- **List:** `GET /repos/{owner}/{repo}/rulesets`, with `includes_parents` (default true) and `targets`. The list items omit `conditions`, `rules` and `bypass_actors`; get each ruleset for those.
- **Get:** `bypass_actors` is returned only to a caller with write access to the ruleset.
- **Rules on a branch:** `GET /repos/{owner}/{repo}/rules/branches/{branch}` returns every active rule for that branch. For acmelabs-15/cli `main`: `non_fast_forward` and `deletion`, each with `ruleset_id: 25461155`.
- **Limits:** up to 75 rulesets per repository. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- **Plans:** "Rulesets are available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, and GitHub Enterprise Cloud." acmelabs-15 is on Team, so both public and private repos can have rulesets. Org-level rulesets need GitHub Enterprise. (Quoted from the "Who can use this feature?" block of https://docs.github.com/en/enterprise-server@3.13/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets; the free-pro-team page's text says "for customers on GitHub Team and GitHub Enterprise plans", and its availability block is not in the article API.)
- **brain's "Protect main"** (`gh api repos/acmelabs-15/brain/rulesets/25457893`, read 2026-10-20):

```json
{
  "id": 25457893,
  "name": "Protect main",
  "target": "branch",
  "source_type": "Repository",
  "source": "acmelabs-15/brain",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "exclude": [],
      "include": [
        "~DEFAULT_BRANCH"
      ]
    }
  },
  "rules": [
    {
      "type": "non_fast_forward"
    },
    {
      "type": "deletion"
    }
  ],
  "node_id": "RRS_lACqUmVwb3NpdG9yec5GCidjzgGEdOU",
  "created_at": "2026-10-19T23:50:57.764-07:00",
  "updated_at": "2026-10-19T23:50:57.801-07:00",
  "bypass_actors": [],
  "current_user_can_bypass": "never",
  "_links": {
    "self": {
      "href": "https://api.github.com/repos/acmelabs-15/brain/rulesets/25457893"
    },
    "html": {
      "href": "https://github.com/acmelabs-15/brain/rules/25457893"
    }
  }
}
```

- **acmelabs-15/cli's "Protect main"** (`gh api repos/acmelabs-15/cli/rulesets/25461155`, read 2026-10-20):

```json
{
  "id": 25461155,
  "name": "Protect main",
  "target": "branch",
  "source_type": "Repository",
  "source": "acmelabs-15/cli",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "exclude": [],
      "include": [
        "~DEFAULT_BRANCH"
      ]
    }
  },
  "rules": [
    {
      "type": "non_fast_forward"
    },
    {
      "type": "deletion"
    }
  ],
  "node_id": "RRS_lACqUmVwb3NpdG9yec5VCbe2zgGEgaM",
  "created_at": "2026-10-20T01:09:23.890-07:00",
  "updated_at": "2026-10-20T01:09:23.917-07:00",
  "bypass_actors": [],
  "current_user_can_bypass": "never",
  "_links": {
    "self": {
      "href": "https://api.github.com/repos/acmelabs-15/cli/rulesets/25461155"
    },
    "html": {
      "href": "https://github.com/acmelabs-15/cli/rules/25461155"
    }
  }
}
```

- The two are the same apart from `id`, `node_id`, `source`, the dates and `_links`. (`diff` of both with those keys removed.)
- `GET repos/acmelabs-15/cli/rulesets` lists exactly one ruleset, 25461155.
- **Probes under `2026-03-10`** (github-ops task 8, 2026-10-20, with the spec's two headers):
  - `repos/acmelabs-15/brain/rulesets?includes_parents=false&per_page=100` returned `[{"id":25457893,"name":"Protect main","target":"branch","source_type":"Repository","source":"acmelabs-15/brain","enforcement":"active","node_id":"RRS_lACqUmVwb3NpdG9yec5GCidjzgGEdOU","_links":{"self":{"href":"https://api.github.com/repos/acmelabs-15/brain/rulesets/25457893"},"html":{"href":"https://github.com/acmelabs-15/brain/rules/25457893"}},"created_at":"2026-10-19T23:50:57.764-07:00","updated_at":"2026-10-19T23:50:57.801-07:00"}]`. Without `includes_parents=false`, the list was the same: acmelabs-15 has no organization rulesets.
  - `repos/acmelabs-15/brain/rulesets/25457893` returned the same fields and values as the read above under `2022-11-28`.
  - `repos/acmelabs-15/jev-gate/rulesets?includes_parents=false&per_page=100` returned `[]`.
- **Names:** a second ruleset with the same name in one repo gets `422 Validation Failed`, "Name must be unique". Reported, not probed: https://github.com/integrations/terraform-provider-github/issues/3214 (2026-02-20).

### 2.7 Create a pull request

https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request

- `POST /repos/{owner}/{repo}/pulls`, 201. Errors: 403, 422.
- Body: `title` (required unless `issue`), `head` (required; `user:branch` for a cross-repo PR in one network), `head_repo`, `base` (required; an existing branch of this repo), `body`, `maintainer_can_modify`, `draft`, `issue`.
- "For organization-owned repositories, you must be a member of the organization that owns the repository to open or update a pull request."
- "This endpoint triggers notifications. Creating content too quickly using this endpoint may result in secondary rate limiting."
- **An open PR for the same head and base:** 422 with `{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"A pull request already exists for <owner>:<branch>."}],...}`. Reported; not probed. https://github.com/crowdin/github-action/issues/287 · https://github.com/google/go-github/issues/1441
- **Probes under `2026-03-10`** (github-ops task 12, 2026-10-20, read-only GETs through `gh api` with the spec's two headers):
  - `repos/acmelabs-15/brain/pulls?head=acmelabs-15%3Achangeset-release%2Fmain&base=main&state=all&per_page=100` returned exactly the 5 PRs from that head (#1, #2, #3, #4, #6). An encoded colon and slash pass through `gh api`, and GitHub decodes them.
  - The same query with `head=changeset-release%2Fmain` (no owner) returned all 7 PRs of brain: GitHub ignores a head filter with no owner.
  - `head=acmelabs-15%3Achangeset-release` (cut at the slash) returned `[]`.
  - The encoded head with `state=open` returned `[]`.
  - A list item carries `number`, `html_url`, `state`, `head.ref`, `head.label`, `head.repo.full_name` and `base.ref`, among about 35 fields; one item is about 16 KB.

### 2.8 Workflow runs

https://docs.github.com/en/rest/actions/workflow-runs

- **List:** `GET /repos/{owner}/{repo}/actions/runs`. Filters: `actor`, `branch`, `event` (for example `push`, `pull_request`), `status`, `created`, `check_suite_id`, `head_sha`, `exclude_pull_requests`, `per_page` (max 100, default 30), `page`. With any of the filters `actor`, `branch`, `check_suite_id`, `created`, `event`, `head_sha` or `status`, the list returns at most 1,000 results.
- **The `status` filter** accepts: `completed`, `action_required`, `cancelled`, `failure`, `neutral`, `skipped`, `stale`, `success`, `timed_out`, `in_progress`, `queued`, `requested`, `waiting`, `pending`. "Only GitHub Actions can set a status of waiting, pending, or requested."
- **In the response,** `status` and `conclusion` are typed only as "string or null"; the page lists no values for them.
- **gh's source lists the values:** status `queued`, `completed`, `in_progress`, `requested`, `waiting`, `pending`; conclusion `action_required`, `cancelled`, `failure`, `neutral`, `skipped`, `stale`, `startup_failure`, `success`, `timed_out`. gh counts `action_required`, `failure`, `startup_failure` and `timed_out` as failures. https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/run/shared/shared.go (lines 26-42, 318-325)
- **Get one run:** `GET /repos/{owner}/{repo}/actions/runs/{run_id}`, 200. Fields include `id`, `name`, `event`, `status`, `conclusion`, `head_branch`, `head_sha`, `path`, `run_attempt`, `run_number`, `workflow_id`, `html_url`, `created_at`, `run_started_at`, `updated_at`.
- **Probe:** `repos/acmelabs-15/brain/actions/runs?head_sha=<sha>&event=push` returned exactly the two push runs (CI and Release) of that commit. acmelabs-15/cli has `total_count: 0` runs, because it has no `.github/workflows/` yet.
- **Probe:** the runs list response carried `Cache-Control: private, max-age=60, s-maxage=60` and an `Etag`, and no `X-Poll-Interval`.
- **Push events and runs:** "Events will not be created for tags when more than three tags are pushed at once." https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push
- **Probes under `2026-03-10`** (github-ops task 13, 2026-10-20, with the spec's two headers, read-only):
  - `repos/acmelabs-15/brain/actions/runs?head_sha=7dee2ef38b7fadfa963ea14c76193457a2f19f91&event=push&per_page=100` returned `total_count: 2`: the CI run 39382027375 (`path` `.github/workflows/ci.yml`) and the Release run 39382027513 (`path` `.github/workflows/release.yml`), both created at `2026-10-20T06:43:16Z`, CI listed first. A run's `path` is its workflow file.
  - `repos/acmelabs-15/brain/actions/runs/39382027513` returned the same fields and values as that run's item in the list.
  - A `head_sha` with no runs returned `{"total_count":0,"workflow_runs":[]}`.
  - Of brain's 25 push runs, 24 concluded `success` and one `failure` (35457136418, the first Release run, 2026-09-19). Every `run_attempt` is 1. A run carries `run_attempt` and `previous_attempt_url`.

### 2.9 Get a git ref

https://docs.github.com/en/rest/git/refs#get-a-reference

- `GET /repos/{owner}/{repo}/git/ref/{ref}`, where `{ref}` is `heads/<branch>` or `tags/<tag>`. "If the :ref doesn't match an existing ref, a 404 is returned." Errors: 404, 409.
- **Probes (2026-10-20):**
  - `repos/acmelabs-15/brain/git/ref/tags/latest`: 200, `{"ref":"refs/tags/latest",...,"object":{"sha":"7dee2ef38b7fadfa963ea14c76193457a2f19f91","type":"commit",...}}`.
  - `repos/acmelabs-15/cli/git/ref/tags/latest` (no such tag): stdout `{"message":"Not Found","documentation_url":"https://docs.github.com/rest/git/refs#get-a-reference","status":"404"}`, stderr `gh: Not Found (HTTP 404)`, exit 1.
  - `repos/acmelabs-15/pinky/git/ref/tags/latest` (an empty repo): `{"message":"Git Repository is empty.",...,"status":"409"}`, stderr `gh: Git Repository is empty. (HTTP 409)`, exit 1.
- **Probes under `2026-03-10`** (github-ops task 10, 2026-10-20, with the spec's two headers): `repos/acmelabs-15/cli/git/ref/heads/main` returned `{"ref":"refs/heads/main",...,"object":{"sha":"bb0c949064ca21a2a00beff42fea6d4c2d24c27e","type":"commit",...}}`; `repos/acmelabs-15/pinky/git/ref/heads/main` (an empty repo) returned the same 409 body as its `tags/latest`; `repos/acmelabs-15/pinky` returned `"visibility":"private","default_branch":"main","size":0`; `repos/acmelabs-no-such-org-4f2b9c/cli` returned 404 `{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"}`.
- **Probes under `2026-03-10`** (github-ops task 13, 2026-10-20, read-only):
  - Every tag of acmelabs-15/brain is lightweight (`object.type` `commit`): `latest`, and `v0.2.0` to `v0.6.0` (`git/matching-refs/tags/`).
  - `repos/changesets/changesets/git/ref/tags/%40changesets%2Fcli%402.27.1` returned `refs/tags/@changesets/cli@2.27.1` with `object.type` `tag`. GitHub reads an encoded `/` and `@` in a tag, and changesets' release tags are annotated (message: the tag's name; tagger: github-actions[bot]).
  - `repos/changesets/changesets/git/tags/5f4a8bc561ec41be9ca7844c8cf2da99e2413e80` returned the tag object, whose `object` is `{"sha":"c11391bc43be1b1c1afcad15b4abb6cf8ad6e354","type":"commit",...}`.
- A 404 can also mean "no access" for a private repo: "GitHub uses a 404 Not Found response instead of a 403 Forbidden response to avoid confirming the existence of private repositories." https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api

## 3. Timing and limits

### 3.1 Right after a repo is created

- **GitHub's docs say nothing** about a delay after `POST /orgs/{org}/repos`. Whether the Actions setting and a ruleset can be set at once is UNVERIFIED.
- **Reports of a delay:**
  - go-github's doc comment on `Repositories.Create`: "this method will return the response without actually waiting for GitHub to finish creating the repository and letting the changes propagate throughout its servers. You may set up a loop with exponential back-off to verify repository's creation." https://github.com/google/go-github/blob/v81.0.0/github/repos.go (lines 527-531) · https://github.com/google/go-github/issues/1585 (2020: `409 Git Repository is empty` on a ref read right after create)
  - terraform-provider-github PR #3060 (2026-01-07) proposed waiting up to 2 minutes after create; it was closed without a merge. https://github.com/integrations/terraform-provider-github/pull/3060
  - A 2026-08-15 commit reports that the first Git Data API tree write to a new repo "can 404 (git storage not provisioned yet) or 409 (empty, before auto_init lands)", and retries 12 times at 600 ms. https://github.com/PackkitLabs/packkit-web/commit/8a3f21206871328f19e271d7264f0939b98de024
  - Default labels appear "over several seconds after a repository is created". https://github.com/JoshuaKGoldberg/new-github-repository
  - gh retries a clone of a just-created repo (1.6).
- **This org's own data point** (section 5): acmelabs-15/cli's `created_at` is 08:09:08Z. The push finished by 08:09:15Z, the Actions setting PUT (sent 08:09:18Z) returned at once, and the ruleset POST (sent 08:09:23Z) succeeded. So settings calls 10 to 15 seconds after creation, after a push, worked once. Calls at 0 seconds, or before the first push, are untested.

### 3.2 After a push, when the run shows

- No GitHub doc gives the delay between a push and the run's appearance in the runs list. UNVERIFIED.
- **Observed on acmelabs-15/brain:** the push event at 06:41:56Z had both runs created at 06:41:57Z; the push event at 21:24:11Z (2026-09-19) had runs at 21:24:12Z and 21:24:13Z; a merge committed at 11:49:47Z had runs at 11:49:50Z. (Push events from `GET repos/acmelabs-15/brain/events`; runs from `actions/runs?head_sha=`.) These are `created_at` times; when the list endpoint first returned them was not measured.
- Common practice in scripts: poll `actions/runs?head_sha=<sha>&event=push` until the run appears, then poll the run. axe-core polls every 30 seconds for up to 5 minutes. https://github.com/dequelabs/axe-core/blob/e841a337/.github/bin/wait-for-workflow-success.sh

### 3.3 Polling and conditional requests

https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

- "You should subscribe to webhook events instead of polling the API." If you must poll: "Poll only as often as you need to, on a fixed schedule. If a response includes an `x-poll-interval` header, wait at least that many seconds."
- No fixed poll interval is recommended for workflow runs. gh's own `run watch` default is 3 seconds (1.8).
- "Making a conditional request does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized with an `Authorization` header." Send the saved `etag` in `if-none-match`, or `last-modified` in `if-modified-since`.
- "Use the same parameters every time you poll the same data. A different page size, page number, or filter produces a different response with a different `etag`."
- **Probe:** a GET of `repos/acmelabs-15/cli/actions/runs?per_page=2` returned `Etag: W/"ff4d...ed8"` with `X-Ratelimit-Remaining: 4972` and `X-Ratelimit-Used: 28`. The same GET with `If-None-Match` returned `304 Not Modified` with the same `4972` and `28`. The 304 did not count.
- "If you are polling and a resource repeatedly returns a 404 Not Found response, do not keep requesting it on every poll."

### 3.4 Rate limits

https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

- **Primary:** 5,000 requests per hour for an authenticated user, shared by every PAT and OAuth app (gh included) that acts for that user. `GITHUB_TOKEN` in Actions: 1,000 per hour per repository. GraphQL has its own primary limit. This token's `core` limit is 5,000 (`gh api rate_limit`).
- **Secondary:**
  - At most 100 concurrent requests, shared by REST and GraphQL.
  - At most 900 points per minute for REST endpoints. Most GET, HEAD and OPTIONS cost 1 point; most POST, PATCH, PUT and DELETE cost 5. A GraphQL mutation costs 5.
  - At most 90 seconds of CPU time per 60 seconds of real time.
  - Content creation: "In general, no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour are allowed. Some endpoints have lower content creation limits." These limits include actions on the web interface.
  - "These secondary rate limits are subject to change without notice." There is no way to check the secondary limit's status.
- **Exceeding a limit:** `403` or `429`. Primary: `x-ratelimit-remaining` is 0; wait until `x-ratelimit-reset` (UTC epoch seconds). Secondary: honour `retry-after`; else wait at least one minute, then back off exponentially, and stop after a set number of retries. "Continuing to make requests while you are rate limited may result in the banning of your integration."
- **Best practices for integrators:** make requests serially, not concurrently ("implement a queue system"). "If you are making a large number of POST, PATCH, PUT, or DELETE requests, wait at least one second between each request." Follow redirects (301, 302, 307). https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- **Timeouts:** GitHub ends a request that takes more than 10 seconds and returns a "Server Error". https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#timeouts
- **The headers** `x-ratelimit-limit`, `-remaining`, `-used`, `-reset` and `-resource` come with each response. Values can differ between responses because several regions serve requests; the headers are authoritative over `GET /rate_limit`.

## 4. Push

- **The `workflow` scope:** "Grants the ability to add and update GitHub Actions workflow files. Workflow files can be committed without this scope if the same file (with both the same path and contents) exists on another branch in the same repository." https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- **Fine-grained:** the "Workflows" permission covers writes to workflow files through the contents, git refs and releases endpoints. https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- **The error without the scope** (reported, not probed), from `git push` over HTTPS with gh's OAuth token. With a classic PAT, the text reads "refusing to allow a Personal Access Token to create or update workflow ...". https://github.com/cli/cli/discussions/7251 · https://stackoverflow.com/questions/64059610

```text
 ! [remote rejected] HEAD -> my-branch (refusing to allow an OAuth App to create or update workflow `.github/workflows/build.yaml` without `workflow` scope)
```

- **The fix** for a gh login: `gh auth login --scopes workflow` (or `gh auth refresh -s workflow`). gh asks for `workflow` itself during an interactive `gh auth login` when the user agrees to set up git's credential helper. (cli/cli discussion #7251, a maintainer's answer, 2023-04-04.)
- **This machine's token has `workflow`** (1.9), so a push of `.github/workflows/` files through gh's helper should pass. Not probed (it would need a push).
- **HTTPS remote form:** `https://github.com/<owner>/<repo>.git`, the API's `clone_url`. "The `https://` clone URLs are available on all repositories, regardless of visibility. `https://` clone URLs work even if you are behind a firewall or proxy." https://docs.github.com/en/get-started/git-basics/about-remote-repositories
- **SSH needs a key:** "To use these URLs, you must generate an SSH keypair on your computer and add the public key to your account on GitHub." (same page) Note 01's marketplace section records the same point: the `owner/repo` shorthand resolves to SSH and fails on a machine with no key.
- **HTTPS fits gh's login:** gh's credential helper serves HTTPS only (patterns start `https://`, 1.5), and this machine's gh `git_protocol` is `https`. So with HTTPS, one gh login covers the API calls and the push.
- **This machine also has SSH working:** `ssh -T git@github.com` answered "Hi loriensleafs! You've successfully authenticated". Another maintainer's machine may not.
- **Checking a push without credentials:** `git ls-remote https://github.com/acmelabs-15/cli.git refs/heads/main` returned `fccb32af385e718a558b4cc5738c393fab216059` (a public repo). A private repo needs credentials.
- **Probes** (github-ops task 11, 2026-10-20, git 2.54.0, read-only `git ls-remote` and one `git clone` of a repo that does not exist, each with no `GIT_` variables, `GIT_TERMINAL_PROMPT=0` and the words `-c credential.https://github.com.helper= -c credential.https://github.com.helper=!gh auth git-credential -c core.askPass=`):
  - gh's login, a repo that does not exist: stderr `remote: Repository not found.` and `fatal: repository 'https://github.com/acmelabs-15/<name>.git/' not found`, exit 128. A clone gets the same, and removes the folder it made.
  - No credential helper at all, for a private repo and for one that does not exist: `fatal: could not read Username for 'https://github.com': terminal prompts disabled`, exit 128. GitHub asks for a login before it says whether the repo exists.
  - `GH_TOKEN=not-a-real-token`: `remote: Invalid username or token. Password authentication is not supported for Git operations.` and `fatal: Authentication failed for '<url>'`, exit 128.
  - An empty `GH_CONFIG_DIR` did not take gh's login away: gh's helper still served a token, and `ls-remote` of the private acmelabs-15/pinky exited 0.
  - Without `-c core.askPass=`, `SSH_ASKPASS=/usr/bin/false` ran: `error: unable to read askpass response from '/usr/bin/false'`, before "terminal prompts disabled".
  - With a local bare repo: a push that is not a fast-forward prints ` ! [rejected]        main -> main (fetch first)`, exit 1; `git push --set-upstream origin refs/heads/main` sets `branch.main.merge` to `refs/heads/main`; `git remote get-url origin` applies a `url.<base>.insteadOf` rewrite, and `git config --get-all remote.origin.url` does not.

## 5. Prior art: how acmelabs-15/cli was created on 2026-10-20

- **The record in this repo:** commit `2b8a451` (2026-10-20T01:09:38-07:00), "docs: the repo is public on GitHub as acmelabs-15/cli", body "Created and pushed with Peter's approval on 2026-10-20, with brain's Actions setting and the Protect main ruleset." `docs/design/spec-interview.md`, "The GitHub repo", records the Actions setting and the ruleset id 25461155. Neither records the commands.
- **The commands**, from the Claude Code session transcript `~/.claude/projects/-Users-peterkloss-Dev/9cffff92-aef5-4430-8a35-c6a72240aef1.jsonl` (the session ran from `~/Dev`). Times are when each call was sent, and when its result came back:

| Sent (UTC) | Command | Output (returned) |
|---|---|---|
| 08:09:06 | `gh repo create acmelabs-15/cli --public --description "The ACMElabs CLI: one tool that makes ACMElabs repos start in shape and keeps them there. Pure Bun." --source /Users/peterkloss/Dev/ACMElabs/cli --remote origin` | `https://github.com/acmelabs-15/cli` (08:09:10) |
| 08:09:12 | `git remote -v && git push -u origin main` | `origin https://github.com/acmelabs-15/cli.git`, `* [new branch] main -> main`, `branch 'main' set up to track 'origin/main'.` (08:09:15) |
| 08:09:17 | `gh api -X PUT repos/acmelabs-15/cli/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true && gh api repos/acmelabs-15/cli/actions/permissions/workflow` | `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}` (08:09:19) |
| 08:09:22 | `printf '%s' '{"name":"Protect main","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}],"bypass_actors":[]}' \| gh api -X POST repos/acmelabs-15/cli/rulesets --input - --jq '{id, name, enforcement, rules: [.rules[].type], include: .conditions.ref_name.include}'` | `{"enforcement":"active","id":25461155,"include":["~DEFAULT_BRANCH"],"name":"Protect main","rules":["non_fast_forward","deletion"]}` (08:09:23) |

- `gh repo create` ran without `--push`; a separate `git push -u origin main` pushed, through the credential helper in `~/.gitconfig` (1.5). The repo had no workflow files then.
- The repo's API `created_at` is 2026-10-20T08:09:08Z, and the ruleset's `created_at` is 08:09:23.890Z. All four steps took about 17 seconds, run one after another, with no retry.
- Earlier the same session read the Actions setting of brain and jev-gate (07:02:37Z) and brain's ruleset (07:06:25Z) as the model.

## 6. Gaps

| Question | Why it is open | Probe that settles it |
|---|---|---|
| Can the Actions setting and the ruleset be set at once after `POST /orgs/{org}/repos`, before any push? | No GitHub doc; reports of 404 and 409 right after create; the one data point here waited 10 to 15 s and pushed first | Create a scratch repo, then PUT the Actions setting and POST the ruleset at 0 s, logging status codes, then delete it. Needs Peter's permission (it creates and deletes a repo). |
| How long after a push does the run appear in `actions/runs?head_sha=`? | No doc; only `created_at` times were seen | In the scratch repo above, push a workflow and poll the list every second, logging the first time the run appears. Needs Peter's permission. |
| What is acmelabs-15's org-level Actions setting? | The org endpoint needs `admin:org`; this token lacks it | `gh auth refresh -h github.com -s admin:org`, then `gh api orgs/acmelabs-15/actions/permissions/workflow`. Needs Peter's permission to widen the token. |
| What is the 409 body when the org blocks the repo's Actions setting? | Undocumented; no report found | Only reproducible by setting the org to restrictive, which changes the org. Peter's call; or accept "409" as the signal. |
| Why does `orgs/acmelabs-15/rulesets` return 404: missing scope or the Team plan? | Both fit | The same `admin:org` refresh, then the GET again. |
| Does a fine-grained PAT or a GitHub App token send no `X-OAuth-Scopes` header? | Only gh's source comment; no probe | A GET with such a token. Needs a token Peter creates. |
| The exact push error text without `workflow` | Reported only | A push of a workflow file with a token that lacks `workflow`, to a scratch repo. Needs Peter's permission. |
| Which classic scope do `PATCH /repos/{owner}/{repo}`, `POST .../rulesets` and `POST .../pulls` check? | Not stated on their pages | `gh api -i` on each write in a scratch repo, reading `X-Accepted-Oauth-Scopes`. Needs Peter's permission. |
| Does a private repo on the Team plan accept a ruleset? | Docs say yes; not probed | Create one in a private scratch repo. Needs Peter's permission. |
| Does `Cache-Control: max-age=60` on the runs list mean a poll can see data up to 60 s old? | Header seen; server behaviour unknown | The push-and-poll probe above, comparing ETag changes against run `created_at`. |
