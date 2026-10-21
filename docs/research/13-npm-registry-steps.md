# npm registry steps: stage, trust, web login, reads and errors

What this is: research for the `npm-ops` module spec. It covers staged publishing that creates a new package, the trusted publisher API, web login, registry reads, org creation, error answers, rate limits, and the npm changes of September and October 2026. It goes deeper than note 04 and re-checks what note 04 marks UNVERIFIED. Researched on 2026-10-20 by a read-only research agent. The registry's `date` headers show 2026-10-21 04:56 to 05:10 UTC, which is the evening of 2026-10-20 local time.

Sources: the npm 12.2.0 tarball (npm-profile 13.0.1, npm-registry-fetch 20.0.1, libnpmpublish 12.0.1), npm 12.2.1 `lib/trust-cmd.js` on unpkg, npm's OpenAPI spec (extracted from https://api-docs.npmjs.com, "npm Registry API" 1.0.0), the source of docs.npmjs.com (npm/documentation on GitHub, `main`), github.blog/changelog, and 24 unauthenticated GETs to registry.npmjs.org, each 2 to 3 seconds apart. No GET returned 429. Nothing was logged in to, sent, created or changed on npm or GitHub. No token was sent. Every source was read on 2026-10-20 unless a line says otherwise.

## 1. Staged publishing that creates a new package

### 1.1 What `npm stage publish` creates

- **Two things.** The registry creates the package with a placeholder version `0.0.0-stage`, and it puts the user's own version (the one in `package.json`) in the stage queue.
  - Docs: "When you stage a package that does not yet exist, npm publishes a placeholder version of the package with the version `0.0.0-stage`. This placeholder version is publicly available, but the staged version and its contents are not publicly available until a maintainer approves the staged package." (docs.npmjs.com/staged-publishing, source commit dd84163 of 2026-09-29, read 2026-10-20)
  - Changelog: "Your first version enters the staged queue and requires a maintainer to promote it before that version becomes available to install. After package creation, you can manage its settings and configure trusted publishing." (github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages, read 2026-10-20)
  - OpenAPI `stagePackageVersion`: "When the package does not yet exist in the registry, staging its first version creates the package with a standardized placeholder version. The authenticated publisher must be allowed to create the package name (for example, hold the relevant scope or organization permissions)."
- **Stale copy warning.** Exa's cached copy of docs.npmjs.com/staged-publishing still says "you cannot stage a brand-new package" (edit of 2026-05-20). The GitHub source is current. Read the source, not a cache.

### 1.2 The placeholder is an npm-made stub (verified on Peter's packages)

`@acmelabs/design-system-react` and `@acmelabs/design-system-mcp` were both created this way on 2026-10-20. The `0.0.0-stage` version object of design-system-react (email removed):

```json
{
  "name": "@acmelabs/design-system-react",
  "version": "0.0.0-stage",
  "_id": "@acmelabs/design-system-react@0.0.0-stage",
  "stub": true,
  "maintainers": [{ "name": "loriensleafs", "email": "<removed>" }],
  "dist": {
    "shasum": "10e9bda59ac5c420e602795e3c46eb0fefadfbec",
    "tarball": "https://registry.npmjs.org/@acmelabs/design-system-react/-/design-system-react-0.0.0-stage.tgz",
    "fileCount": 2,
    "integrity": "sha512-6A/bvL5jPu/CkJrr…",
    "signatures": [{ "sig": "…", "keyid": "SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U" }],
    "unpackedSize": 351
  },
  "_npmUser": { "name": "loriensleafs", "email": "<removed>" },
  "description": "Temporary package placeholder for staged publishing",
  "directories": {}
}
```

- It has `"stub": true`, no `_npmVersion` and no attestations. The user's tarball is not in it.
- The stub tarball (376 bytes) holds two files:
  - `package/package.json`: `{"name":"@acmelabs/design-system-react","version":"0.0.0-stage","stub":true,"description":"Temporary package placeholder for staged publishing"}`
  - `package/README.md`: "# Temporary Holding Version … An operational version to replace this has been submitted for review and is awaiting a staged release."
- `_npmUser` is the account that staged.
- `time.created` equals the time of `0.0.0-stage`. So the package exists from the moment of the stage, before any approval (react: created 12:41:49 UTC, 0.3.0 approved 13:37:11 UTC).

### 1.3 Which dist-tag points at the placeholder

- **`latest`.** Two packages that never published a `latest` version still show it:
  - `veleris-native-sightings`: `{"latest":"0.0.0-stage","beta":"0.1.15"}`, created 2026-10-02, 13 later versions under `beta`.
  - `@deepraxis/cli`: `{"latest":"0.0.0-stage","dev":"0.1.0-dev.79876bd"}`, created 2026-10-18, 26 later versions under `dev`.
  - Found with `GET /-/v1/search?text="Temporary package placeholder for staged publishing"` (read 2026-10-20). The search answer lists 2,357,896 loose hits; the first 20 include 4 packages still on the stub.
- **Consequences while `latest` is the stub:**
  - `npm install <name>` installs the stub (a `package.json` with no code).
  - The top-level `description` stays "Temporary package placeholder for staged publishing" (both packages above). On design-system-react it changed to the real description once a real version took `latest`.
- **The first real `latest` publish moves it.** npm's publish check ignores prerelease and deprecated versions when it looks for a higher version (`#registryVersions` in `lib/commands/publish.js`), so `0.0.0-stage` never blocks `0.1.0` with the default tag.

### 1.4 The staged version: approve, reject or leave

- **Status.** A staged item is `validating` (automated malware scan) and then `staged` (ready for review). The approve button stays disabled until the scan completes; the page refreshes every minute (github.blog/changelog/2026-09-03-multiple-trusted-publishing-configurations-for-npm, read 2026-10-20). OpenAPI `StagePackageVersion.status` enum: `validating`, `staged`.
- **Approve.** `npm stage approve <stage-id>`, or Approve on npmjs.com ("Staged Packages" tab). Both ask for 2FA. The approved version publishes with the dist-tag chosen at stage time.
- **Reject.** `npm stage reject <stage-id>` asks for 2FA. npm warns: "Rejecting will permanently delete this staged publish record and tarball from the registry." (`lib/commands/stage/reject.js`)
- **Leave it.** No source documents an expiry for a staged version. UNVERIFIED either way.
- **Approval is not needed for the package to work.** `@deepraxis/cli` published 26 `dev` versions directly (no trusted publisher, npm 10.9.8), starting 55 seconds after the placeholder. Whether its staged version is still queued cannot be seen without its owner's token.
- **The staged version number is taken.** "Staged packages share the same semver version unique index as published packages — you cannot publish a version that already exists as a staged version for that package." (npm 12.2.0 `docs/content/commands/npm-stage.md`) So a staged `0.1.0` blocks a CI publish of `0.1.0` until it is approved or rejected.
- **A rejected number can be used again.** The same doc tells users to reject and re-stage the same version to change its tag. (Read from docs; not tested.)
- **The tag is fixed.** "The tag is an immutable property of the staged package."
- **What a reject does to the placeholder** of a new package: UNVERIFIED. No source says.

### 1.5 Tokens and 2FA

| Step | Token | 2FA |
|---|---|---|
| Stage publish | Any: session token, GAT with or without bypass, stage-only GAT, OIDC token if the trust config allows staging. A new package needs a user token, because a trust config needs an existing package. | None at the call. The account must have 2FA on (prerequisite). |
| Approve, reject | User token. OIDC tokens cannot run them. | Yes, every time (`npm-otp`, or the web flow in section 2.3). |
| List, view, download | User token. | No (npm-stage.md table). |

- Sources: the npm-stage.md token table (npm 12.2.0); docs.npmjs.com/trusted-publishers ("Other stage subcommands … require interactive authentication and cannot use OIDC tokens"); github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation.
- In npm's code, stage skips `otplease`: "Stage intentionally bypasses otplease — 2FA is deferred to approve/reject" (`lib/commands/publish.js` line 207).

### 1.6 Endpoints

All need `Authorization: Bearer <token>`. Paths take the escaped name, for example `@acmelabs%2fdesign-system`.

| Action | Call | Answer |
|---|---|---|
| Stage | `POST /-/stage/package/{name}` | 201 `{"message":"Package version staged successfully.","stageId":"<uuid>"}`; also 400, 401, 404, 409, 429, 500 |
| List | `GET /-/stage?page=0&perPage=100&package=<name>` | 200 `{"items":[…],"page":0,"perPage":10,"total":2}` |
| View | `GET /-/stage/{stage-id}` | 200 one item: `id`, `packageName`, `version`, `tag`, `createdAt`, `actor`, `actorType` (`user` or `trusted automation`), `access`, `shasum`, `status` |
| Tarball | `GET /-/stage/{stage-id}/tarball` | 200 `application/octet-stream` |
| Approve | `POST /-/stage/{stage-id}/approve` with `npm-otp` | 201 `{"message":"Package version approved and published successfully."}`; 401 web flow, 403, 404, 409, 429 |
| Reject | `DELETE /-/stage/{stage-id}` with `npm-otp` | 204; 401 web flow, 403, 404, 409 |
| Version status | `GET /-/package/{name}/version/{version}/status` | 200 `{"packageName","version","status"}`, status one of `published`, `validating`, `staged`, `blocked`, `deleted`. A caller with no publish access gets 404. |

- Sources: OpenAPI paths `/-/stage*` and `/-/package/{package-name}/version/{version}/status`; npm 12.2.0 `lib/commands/stage/*.js` (list pages with `perPage=100` until `items.length >= total`).
- **Stage request body** (libnpmpublish 12.0.1 `publish.js`; OpenAPI `StagedPackumentRequest`). It is the same body as a normal publish (`PUT /{name}`), sent as POST:

```json
{
  "_id": "@acmelabs/foo",
  "name": "@acmelabs/foo",
  "description": "…",
  "dist-tags": { "latest": "0.1.0" },
  "versions": {
    "0.1.0": {
      "…package.json fields…": "…",
      "_id": "@acmelabs/foo@0.1.0",
      "_nodeVersion": "…",
      "_npmVersion": "…",
      "dist": {
        "integrity": "sha512-…",
        "shasum": "<sha1 hex>",
        "tarball": "http://registry.npmjs.org/@acmelabs/foo/-/foo-0.1.0.tgz"
      }
    }
  },
  "access": "public",
  "_attachments": {
    "@acmelabs/foo-0.1.0.tgz": {
      "content_type": "application/octet-stream",
      "data": "<base64 tarball>",
      "length": 1234
    }
  }
}
```

- Required fields: `name`, `versions`, `_attachments`. "The registry assumes the FIRST key in this object is the newest version being published. Only include the single new version." A provenance bundle may be a second attachment (`application/vnd.dev.sigstore.bundle+json;version=0.3`).
- npm sends `content-type: application/json`, `npm-command: stage`, `npm-auth-type: web` and its `user-agent` (npm-registry-fetch `getHeaders`; `lib/npm.js` sets `npmCommand` to the top-level command).
- The npm CLI refuses to stage a prerelease without `--tag`. The registry rule is UNVERIFIED.

### 1.7 After the placeholder: a direct publish from CI

- **Peter's own path on 2026-10-20** (design-system-react; design-system-mcp is the same):
  1. 12:41:49 UTC: a stage created the package and `0.0.0-stage`.
  2. 13:37:11 UTC: `0.3.0` was approved and published. `_npmUser` is `loriensleafs`. It has SLSA provenance from `acmelabs-15/design-system/.github/workflows/publish-package.yml@refs/tags/v0.3.0`, event `workflow_dispatch`. So `0.3.0` was staged from CI with a user token, not OIDC (inference: OIDC cannot act on a package that does not exist yet).
  3. 19:39:44 UTC: `0.3.1` was published directly by "GitHub Actions" through trusted publisher config `901ff37b-…`, event `release`. No approval.
- So yes: a trust config with direct publish allowed publishes from CI with no approval, after the package exists.
- **Not shown:** a direct OIDC publish when the only version is the stub (no approved version first). The docs allow trust config after "package creation". UNVERIFIED by a real case.

### 1.8 Deprecate or unpublish the placeholder later

- **Unpublish** (docs.npmjs.com/policies/unpublish, read 2026-10-20): within 72 hours if no package depends on it; later only with no dependents, under 300 downloads last week, and one maintainer. The version number `0.0.0-stage` can never be used again in that package (harmless).
- **Deprecate:** `npm deprecate <name>@0.0.0-stage "<message>"` is allowed. A stage-only token can deprecate versions (2026-09-18 changelog).
- **Should it be removed?** No source asks for it. Peter's packages and the others above keep it. Once `latest` moves, nothing installs it by accident: ranges do not match a prerelease, and npm's publish check ignores it.

## 2. The trusted publisher API

### 2.1 Endpoints and bodies

| Action | Call | Answer |
|---|---|---|
| Create | `POST /-/package/{name}/trust`, body is an **array** | 200 array of configs with `id` |
| List | `GET /-/package/{name}/trust` | 200 array (empty `[]` when none) |
| Delete | `DELETE /-/package/{name}/trust/{config-uuid}` | 204 |

All three need a user token, write access, 2FA on the account, and `npm-otp` ("Always required for this endpoint"). A bypass-2FA GAT gets 403. The package must exist. (OpenAPI `configureTrustedPublisher`, `getTrustedPublishers`, delete.)

Request (npm 12.2.0 `lib/commands/trust/github.js` and `lib/trust-cmd.js`; OpenAPI example):

```json
[
  {
    "type": "github",
    "claims": {
      "repository": "acmelabs-15/foo",
      "workflow_ref": { "file": "release.yml" },
      "environment": "npm"
    },
    "permissions": ["createPackage", "createStagedPackage"]
  }
]
```

- `environment` is left out when not used (`...(environment) && { environment }`).
- `workflow_ref` may also be a full string for an exact match (schema `oneOf`); npm sends `{file}`.
- The answer has the same shape plus `"id": "<uuid>"`.

### 2.2 Permissions

| Name | Allows | npm CLI flag |
|---|---|---|
| `createPackage` | `npm publish` (direct) | `--allow-publish` |
| `createStagedPackage` | `npm stage publish` | `--allow-stage-publish` (alias `--allow-staged-publish`) |
| `manageDistTags` | `npm dist-tag` add, rm and ls (also reading a private package's tags) | none in npm 12.2.0 or 12.2.1 |

- `manageDistTags` is opt-in, off by default, independent of `createPackage`, and covers all tags of the package (OpenAPI; github.blog/changelog/2026-09-30-opt-in-dist-tag-permissions-for-npm-trusted-publishing). Using it from CI needs npm 11.21.0 or 12.2.0 or later.
- The npm CLI needs at least one of its two flags. Since 2026-09-03 the website always allows staging and makes direct publish opt-in (docs.npmjs.com/trusted-publishers). Whether the API accepts `["createPackage"]` alone, or adds `createStagedPackage` itself, is UNVERIFIED.

### 2.3 2FA on trust calls

- **Code OTP:** send `npm-otp: <code>`.
- **Web 2FA** (OpenAPI 401 example `web_auth_flow`; npm 12.2.0 `lib/utils/auth.js`):
  1. Send the call with no `npm-otp`, with `npm-auth-type: web` and `npm-command: trust`.
  2. The answer is 401 with `{"authUrl":"https://www.npmjs.com/auth/cli/<uuid>","doneUrl":"https://registry.npmjs.org/-/v1/done?authId=<uuid>"}`.
  3. Open `authUrl` in the browser. Poll `doneUrl` the same way as web login (section 3.2). The 200 body `{"token":"…"}` holds the OTP.
  4. Send the call again with `npm-otp: <token>`.
- Without the web headers, the 401 carries the header `npm-notice: Open https://www.npmjs.com/login/<uuid> to use your security key for authentication`.
- npm's client only treats a 401 as an OTP need when `www-authenticate` holds `otp` or the body says "one-time pass" (section 6.2). So the web 401 must carry `www-authenticate: OTP` too. That header is inferred from npm's code, not seen. UNVERIFIED.
- **5-minute skip:** "During two-factor authentication, you'll see an option on the npm website to skip two-factor authentication for the next 5 minutes." npm suggests a 2-second sleep between trust calls (npm 12.2.0 `docs/content/commands/npm-trust.md`, "Bulk Usage"). Whether the skip also covers stage approve or reject: UNVERIFIED.
- npm runs the web or code OTP flow only when stdin and stdout are both terminals. Otherwise it throws the error (`otplease`, auth.js line 10).

### 2.4 Expiry and limits

- **48 hours:** "Unvalidated npm trusted publishing configurations now expire 48 hours after creation and can no longer authorize publishing … Your configuration becomes validated and exempt from expiry after its first successful publish." An expired config stays visible, does not count toward the limit, and must be deleted and created again. (github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire; docs.npmjs.com/trusted-publishers "Trusted publisher configuration expiry", source commit 5152d27 of 2026-10-06)
- The same changelog: npm now rejects OIDC tokens from `issue_comment` events, as well as `pull_request_target`.
- **10 configs per package** since 2026-09-03. Configs are additive: a publish passes if any one config matches. A config cannot be edited: delete it and create a new one. (docs.npmjs.com/trusted-publishers; 2026-09-03 changelog)
- **Doc drift, still present:** the npm 12.2.0 `npm-trust.md` says "the registry only supports one configuration per package", and the OpenAPI 409 example says "trusted publisher config already exists for the package. Please delete and re-create." Both predate 2026-09-03.

### 2.5 Reusable workflows: the trust config names the caller's file

- **npm's docs:** "Some GitHub Actions workflows use `workflow_call` to invoke other workflows that run `npm publish` … When this happens, validation checks the calling workflow's name instead of the workflow that actually contains the publish command, which can cause configuration mismatches. The `id-token: write` permission must also be given to both parent and child workflows." (docs.npmjs.com/trusted-publishers, "Troubleshooting", read 2026-10-20)
- **Why:** in a reusable workflow, GitHub's OIDC token keeps the caller in `repository`, `workflow` and `workflow_ref`, and puts the called file only in `job_workflow_ref` (docs.github.com, "Using OpenID Connect with reusable workflows"). npm matches `claims.workflow_ref.file` against `workflow_ref`.
- **So for acmelabs:** when `acmelabs-15/foo/.github/workflows/release.yml` calls a reusable workflow in `acmelabs-15/.github`, the config is `repository: "acmelabs-15/foo"`, `file: "release.yml"`. Both workflows need `id-token: write`.
- **Open issue:** npm/documentation#1755 ("Trusted Publishing with re-usable GitHub Workflows"), open since 2025-10-27. Users ask npm to check `job_workflow_ref`. No npm staff answer as of its last comment (2026-06-19). The 10-config limit now lets several caller files each have a config.
- **Third-party evidence agrees, with one retracted exception:** facebook/lexical `scripts/npm/setup-trusted-publishing.mjs` ("npm matches `claims.workflow_ref.file` against the OIDC token's `workflow_ref` claim, which is the caller"); Zondax/_workflows PR #104 first claimed the reusable file, and commit b151bf3 corrected it to the caller per npm's docs.
- **No first-hand case:** Peter's packages publish from a direct workflow. The signing certificates of design-system-react 0.3.0 and 0.3.1 show the same file as Build Signer URI and Build Config URI (`…/design-system/.github/workflows/publish-package.yml`). A reusable-workflow publish for an acmelabs package is UNVERIFIED.

### 2.6 `environment` and `repository.url`

- **`environment`** is optional ("If using GitHub environments for deployment protection"). When the config names one, the job must run in that environment. Whether a config with no environment accepts a job that has one is UNVERIFIED.
- **`repository.url`** in `package.json` "must exactly match your GitHub repository" (docs.npmjs.com/trusted-publishers). The compare is case-sensitive.
  - Empty or different, with provenance on: 422 `Error verifying sigstore provenance bundle: Failed to validate repository information: package.json: "repository.url" is "", expected to match "https://github.com/<owner>/<repo>" from provenance` (npm/cli#8036; github.com/guardian/example-npm-publish).
  - Different from the trust config: 404 (guardian example).
  - `npm trust github` reads `--repo` from `repository.url` when the flag is absent, and warns when the two differ (`trust-cmd.js`).
  - Design-system uses `git+https://github.com/acmelabs-15/design-system.git` and publishes with OIDC.

## 3. Web login

### 3.1 Protocol (npm-profile 13.0.1 `lib/index.js`)

1. `POST /-/v1/login` with body `{}`, `content-type: application/json`, `npm-auth-type: web`, `npm-command: login`. No auth needed.
2. The answer is JSON `{"loginUrl": "...", "doneUrl": "..."}`. Both must be `http:` or `https:` URLs, else npm throws "Invalid response from web login endpoint". The docs show `loginUrl` as `https://www.npmjs.com/login?next=/login/cli/<uuid>` (docs.npmjs.com/accessing-npm-using-2fa).
3. Any 4xx or a 500 on the POST means "Web login not supported" (`ENYI`); npm then falls back to a username and password prompt.
4. When `doneUrl` names `registry.npmjs.org` but the user set another registry, npm rewrites the host to that registry (`replaceDoneUrlOrigin`).

This endpoint is not in the OpenAPI spec. It is npm's default (`auth-type` default `web`).

### 3.2 Polling `doneUrl` and how long npm waits

- `GET doneUrl` with npm's cache off.
- **200** with `{"token": "…"}`: done. A 200 with no `token` is an error.
- **202:** wait `retry-after` seconds, then poll again. A 202 with no `retry-after`, or `0`, polls again at once (no floor).
- **Any other status:** "Invalid response from web login endpoint".
- **No overall time limit in npm.** Each GET has npm's 5-minute `fetch-timeout`, and a GET that gets 408, 420, 429 or 5xx is retried twice with 10 to 60 seconds backoff (make-fetch-happen `lib/remote.js`; config defaults `fetch-retries` 2, `fetch-retry-mintimeout` 10000, `fetch-retry-maxtimeout` 60000). npm stops on success, on an error, or on Ctrl+C.
- How long the registry keeps a login session open before `doneUrl` stops answering 202: UNVERIFIED.

### 3.3 The token

- A session token. "When you use `npm login` you'll receive a two-hour session token … Unlike traditional tokens, session tokens won't appear in your UI or CLI token lists … During these sessions, 2FA is enforced for publishing operations." (github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available, read 2026-10-20)
- **12 hours stays UNVERIFIED.** A second secondary source now says the same (dailybreach.in, 2026-01-10: "extended the session duration to 12 hours starting December 12"). No npm or GitHub page says so.
- **What it can do:**
  - Stage publish: yes, no 2FA.
  - Direct publish: yes, with 2FA.
  - Trust create, list, delete and stage approve or reject: yes, with 2FA. These calls refuse only bypass-2FA GATs and basic auth.

### 3.4 Where `npm login` stores it

- `npm login` calls `setCredentialsByURI(registry, { token })`, deletes a legacy `_token`, and saves the **user** config (`lib/commands/login.js`). The line is:

```ini
//registry.npmjs.org/:_authToken=<token>
```

- The file is `~/.npmrc`, or the file named by `--userconfig`. With `--scope`, npm also writes `@scope:registry=<registry>`.

### 3.5 Opening the browser, and no terminal

- npm prints `Login at:` and the URL, then asks `Press ENTER to open in the browser...` (`lib/utils/open-url.js`).
- On ENTER it runs `open` on macOS, `xdg-open` on Linux, `start ""` on Windows, and `sensible-browser` on WSL (WSL also needs `BROWSER`) (`@npmcli/promise-spawn` `open`). The `browser` config can name another program or `false`.
- When stdin or stdout is not a terminal, or `browser` is `false`, npm only prints the URL and keeps polling. The user must open the URL by hand.
- The poll and the prompt run side by side. When the poll finishes, npm cancels the prompt.

## 4. Registry reads (unauthenticated curl, read 2026-10-20)

| Read | Status | Body (trimmed) | Cache headers |
|---|---|---|---|
| `GET /@acmelabs%2fdesign-system`, `Accept: application/json` | 200 | 4,882,584 bytes. `dist-tags` `{"latest":"0.3.2"}`; `time.modified` `2026-10-20T22:01:05.356Z`; `_rev` `5-…` | `cache-control: public, max-age=300`, `cf-cache-status: REVALIDATED`, `last-modified: Tue, 20 Oct 2026 22:01:07 GMT`, `etag`, `vary: accept-encoding, accept` |
| Same, `Accept: application/vnd.npm.install-v1+json` | 200 | 6,606 bytes. `{"name","modified","dist-tags","versions":{"0.3.2":{"name","version","dependencies","dist":{integrity, shasum, tarball, fileCount, unpackedSize, attestations, signatures}}}}` | same as above, `content-type: application/vnd.npm.install-v1+json` |
| `GET /-/package/@acmelabs%2fdesign-system/dist-tags` | 200 | `{"latest":"0.3.2"}` | `cf-cache-status: DYNAMIC`, no `cache-control` |
| `GET /@acmelabs%2fdoes-not-exist-xyz` | 404 | `{"error":"Not found"}` | none |
| `GET /-/org/acmelabs/package` | 200 | `{"@acmelabs/design-system":"write","@acmelabs/design-system-react":"write","@acmelabs/design-system-devtools":"write","@acmelabs/design-system-mcp":"write","@acmelabs/design-system-browser":"write"}` | `DYNAMIC` |
| `GET /-/org/acmelabs-free-scope-xyz/package` | 404 | `{"error":"Scope not found"}` | none |
| `GET /-/org/acmelabs/user` | 200 | `{}` | `DYNAMIC` |
| `GET /-/whoami` | 401 | `{"error":"Unauthorized"}` | `DYNAMIC` |
| `GET /-/npm/v1/user` | 401 | empty | `DYNAMIC`, `npm-notice: npm tokens that bypass 2FA are being restricted for account changes and direct publishing. Learn how to prepare: https://gh.io/npm-gat-bypass2fa-deprecation` |
| `GET /-/package/@acmelabs%2fdesign-system/trust` | 401 | `{"message":"Bearer token authorization is required"}` | `DYNAMIC`, same `npm-notice` |
| `GET /-/stage` | 401 | `{"error":"Unauthorized","message":"Unauthorized"}` | `DYNAMIC`, same `npm-notice` |
| `GET /-/package/@acmelabs%2fdesign-system/version/0.2.0/status` | 401 | `{"error":"Unauthorized","message":"Unauthorized"}` | `DYNAMIC`, same `npm-notice` |
| `GET /-/package/@acmelabs%2fdesign-system/visibility` | 200 | `{"public":true}` | `DYNAMIC`, same `npm-notice` |
| `GET /-/npm/v1/attestations/@acmelabs%2fdesign-system@0.2.0` | 200 | 15,441 bytes: a publish attestation and SLSA provenance v1 | `cache-control: public, max-age=31557600`, `cf-cache-status: HIT`, `age: 51029` |
| `GET /-/v1/search?text=…` | 200 | `{"total":…,"objects":[{"package":{name, version, date, description}}]}` | `cache-control: max-age=300`, `DYNAMIC` |

What this means for staleness:

- **Package documents** (full and abbreviated) may come from Cloudflare for up to 300 seconds. In this read the copy was current: `last-modified` was 2 seconds after `time.modified`. Whether npm purges the CDN on each publish is UNVERIFIED.
- **Fresh reads** come from the uncached endpoints: dist-tags, `/-/org/…` and the 404s carry no `cache-control`. Use `/-/package/<name>/dist-tags` to see a new version or tag right after a publish.
- **Attestations** are immutable and cached for a year. Only the attestation answer carried an `Age` header; no other read did.
- **Size:** the full design-system document is 4.88 MB, because 0.3.1 and 0.3.2 each carry a 2.4 MB `exports` map (0.3.2: 55,399 files, 94.8 MB unpacked). Read the abbreviated document or the dist-tags endpoint.
- **2FA state of a user:** `GET /-/npm/v1/user` (what `npm profile get` reads) returns `tfa` (`{mode: "auth-only" | "auth-and-writes", pending}` or empty) and `email_verified` (`lib/commands/profile.js`). It is not in the OpenAPI spec. With a session token: UNVERIFIED.
- `GET /-/whoami` with a token returns `{"username": "…"}` (`lib/utils/get-identity.js`).

## 5. Org creation

- **Start URL: `https://www.npmjs.com/org/create`, now verified.** Signed out, it shows the npm Sign In page with a "Create Account" link to `/signup?next=/org/create` (read through Exa on 2026-10-20; curl still meets bot protection).
- **What the user does** (docs.npmjs.com/creating-an-organization, source read 2026-10-20):
  1. Sign in.
  2. Profile picture, then "Add an Organization".
  3. Type the name; it becomes the scope.
  4. Choose "Unlimited public packages" (free) and click Create. The paid plan is "Unlimited private packages".
  5. Optional: invite members.
  6. Click Continue.
- **2FA or a verified email for org creation:** no source says either is needed. UNVERIFIED.
  - Creating and publishing a package needs 2FA on the account or a bypass GAT (docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification).
  - A 2017 npm blog post requires a verified email to publish a new package. Whether that still holds is UNVERIFIED.
- **What the poll sees:** `GET /-/org/<scope>/package` changes from 404 `{"error":"Scope not found"}` to 200. A new org with no packages answers `{}` (as `@acmelabz` did in note 03).
  - Neither answer is CDN-cached, so the poll should see the org as soon as the registry knows it. How many seconds that takes: UNVERIFIED.
  - A user's own name also answers 200 here. To tell an org from a user, `GET /-/org/<scope>/user` answers `{}` for an org and `{"<name>":"owner"}` for a user (note 04; seen again: `/-/org/acmelabs/user` is `{}`).

## 6. Errors

### 6.1 The answers a step must map

| Case | Status | Body | Headers | npm `code` |
|---|---|---|---|---|
| No token (`/-/whoami`) | 401 | `{"error":"Unauthorized"}` | — | `E401` |
| No token (trust) | 401 | `{"message":"Bearer token authorization is required"}` | `npm-notice` | `E401` |
| No token (stage, version status) | 401 | `{"error":"Unauthorized","message":"Unauthorized"}` | `npm-notice` | `E401` |
| Bad or expired token | 401 | spec: `{"message":"Unauthorized"}` | — | `E401` |
| OTP needed, web headers sent | 401 | `{"authUrl":"…","doneUrl":"…"}` | `www-authenticate: OTP` (inferred, UNVERIFIED) | `EOTP` |
| OTP needed, no web headers | 401 | a message, or text with "one-time pass" | `npm-notice: Open https://www.npmjs.com/login/<uuid> …`; `www-authenticate: OTP` | `EOTP` |
| Login from a blocked IP | 401 | — | `www-authenticate` holds `ipaddress` | `EAUTHIP` |
| 2FA not on for the account | 403 | `{"message":"Please enable 2fa for your account"}` | — | `E403` |
| Bypass-2FA GAT on trust create or delete | 403 | `{"error":"Granular access tokens that bypass two-factor authentication may not perform this action. For more info, visit: https://gh.io/npm-gat-bypass2fa-deprecation"}` | — | `E403` |
| No rights on the resource | 403 | `{"message":"Insufficient permissions to access …"}` | — | `E403` |
| Publish over an existing version | 403 | `You cannot publish over the previously published versions: 0.0.9.` (npm/cli#4302) | — | `E403` |
| Scoped publish without rights, or an OIDC config mismatch | 404 | `Not found`; npm adds `'<name>@<v>' is not in this registry` or `could not be found or you do not have permission to access it` | — | `E404` |
| Trust on a package that does not exist | 404 | `{"message":"Package not found"}` | — | `E404` |
| Name or scope free (reads) | 404 | `{"error":"Not found"}`, `{"error":"Scope not found"}` | — | `E404` |
| Version or stage conflict | 409 | spec: `{"message":"Conflict - The request could not be completed due to a conflict."}` | — | `E409` |
| `repository.url` does not match provenance | 422 | `Error verifying sigstore provenance bundle: Failed to validate repository information: …` | — | `E422` |
| Bad stage body | 400 | `{"message":"Bad Request - Missing required fields: name, version, _attachments"}` | — | `E400` |
| Rate limit | 429 | spec: `{"message":"Too Many Requests - Rate limit exceeded."}`; note 04 saw a Cloudflare 1015 page | `retry-after` UNVERIFIED | `E429` |

Bodies use `error` on older endpoints and `message` on newer ones; read both. Sources: OpenAPI responses (`Unauthorized`, `UnauthorizedWithWebAuthn`, `Forbidden`, `Conflict`, `TooManyRequests`), this note's reads, and the issues named in the table.

### 6.2 How npm tells "needs OTP" from "forbidden"

From npm-registry-fetch 20.0.1 `lib/check-response.js`:

1. A **401** with `www-authenticate`: npm splits the header on commas and lowercases it.
   - Holds `ipaddress`: `EAUTHIP`, "Login is not allowed from your IP address".
   - Holds `otp`: `EOTP`, "OTP required for authentication".
   - Anything else: "Unable to authenticate, need: <header>", code `E401`.
2. A **401** without that header, whose body matches `/one-time pass/`: `EOTP`.
3. **Every other status**, 403 included: a general error with code `E<status>` and message `<status> <statusText> - <METHOD> <url> - <body.error or body.message>`.

Then `otplease` (`lib/utils/auth.js`): an `EOTP` whose body has `authUrl` and `doneUrl` runs the web flow; any other `EOTP`, or an `E401` whose body says "one-time pass", prompts for a code. So "needs OTP" is a 401 with an OTP signal, and "forbidden" is a 403. A 403 never starts a 2FA prompt.

## 7. Rate limits

- **No published numbers** for registry.npmjs.org.
  - The 2017 rate-limit post (blog.npmjs.org) is marked "no longer applicable".
  - The 2019 acceptable-use post sets 5 million requests a month.
  - The crawler policy asks website crawlers for 1 request per second or less (docs.npmjs.com/policies/crawlers).
- **npm's own advice for trust calls:** sleep 2 seconds between calls (npm-trust.md).
- **A 429:** the spec lists 429 for stage, approve and version status, with a JSON `message`. Note 04 met a Cloudflare 1015 page (HTML, not JSON). Whether `retry-after` comes with it: UNVERIFIED.
- **npm's client** retries a GET on 408, 420, 429 and 5xx: 2 retries, 10 to 60 seconds apart. It never retries a POST (make-fetch-happen `remote.js`).
- **This session:** 24 GETs, 2 to 3 seconds apart, no 429.
- **Safe poll interval:**
  - Use `retry-after` from the login and OTP `doneUrl` (with a floor of 1 second, since npm has none).
  - Poll `/-/org/<scope>/package` every 5 seconds or slower.
  - On a 429 or a 1015 page, back off and stop after a bound.

## 8. npm changes in September and October 2026

| Date | Change | Touches |
|---|---|---|
| 2026-09-03 | Up to 10 trusted publisher configs per package, additive. New configs allow staging by default; direct publish is opt-in. Staged versions can be approved only after the malware scan. Staged history in the versions tab. | Trusted publisher |
| 2026-09-09 | A sign-in with a recovery code puts any account on a 72-hour hold: no publishing and no token creation. | Login, all write steps |
| 2026-09-18 | Stage-only granular tokens ("Read and write (stage only)"). They can still move dist-tags and deprecate versions. Direct publish with bypass-2FA tokens ends around January 2027. | Placeholder, tokens |
| 2026-09-30 | Opt-in `manageDistTags` ("Allow npm dist-tag") per trust config. | Trusted publisher |
| 2026-10-02 | `npm stage publish` can create a new package (placeholder `0.0.0-stage`). | Placeholder |
| 2026-10-02 | Unvalidated trust configs expire after 48 hours. OIDC tokens from `issue_comment` events are rejected. | Trusted publisher |
| 2026-10-20 | Dependabot supports npm 12 and Bun 1.4. | CI only |
| August 2026 (docs) | Bypass-2FA tokens can no longer do account-identity or governance actions; these always need an interactive 2FA challenge (docs.npmjs.com/about-access-tokens). | Trust, org members |

Sources: the github.blog/changelog posts of those dates (read 2026-10-20). The changelog's npm label page shows no posts (a broken filter), so the dates come from the posts and the month pages. The npm registry ships npm 12.2.0 as `latest` and 12.2.1 as `next-12`.

## 9. Corrections to notes 03 and 04

- `@acmelabs` now holds **5** packages, not 1 (section 4). design-system is at 0.3.2.
- `0.0.0-stage` is an npm stub with `"stub": true`, not the user's tarball. It takes the `latest` tag (sections 1.2 and 1.3).
- The org-creation URL is now verified (section 5).
- The 12-hour session lifetime is still UNVERIFIED (section 3.3).
- An OTP need is a **401**, not a 403 (section 6.2).
- `manageDistTags` has no CLI flag in npm 12.2.1 either (section 2.2).

## What this means for npm-ops

| Step | Plain `fetch` under Bun | Calls | Browser or 2FA |
|---|---|---|---|
| Registry reads | Yes | `GET /<name>` (abbreviated `Accept`), `GET /-/package/<name>/dist-tags`, `GET /-/org/<scope>/package`, `GET /-/org/<scope>/user` | Neither |
| Web login | Yes | `POST /-/v1/login` `{}`, then poll `doneUrl` | Browser: password and 2FA |
| Org creation | Poll only | Open `https://www.npmjs.com/org/create`, then poll `GET /-/org/<scope>/package` | Browser only |
| Placeholder | Yes, with a built body | `POST /-/stage/package/<name>` (session token); then list, approve or reject | No 2FA to stage; 2FA to approve or reject |
| Trusted publisher | Yes | `POST /-/package/<name>/trust` with the web 2FA retry; `GET` to check | Browser for the 2FA step |

1. **Registry reads.** No auth.
   - Use the abbreviated document or the dist-tags endpoint; the full document can be megabytes.
   - A free name is 404 `Not found`. A free scope is 404 `Scope not found`.
   - Package documents may lag up to 300 seconds; dist-tags and org reads do not.
   - UNVERIFIED: whether npm purges the CDN on publish.
2. **Web login.**
   - Honour `retry-after` with a floor, and set an overall time bound (npm has none).
   - The token lasts 2 hours (official). Where acmelabs keeps it (memory only, or the user npmrc line) is a spec choice.
   - UNVERIFIED: the server-side end of a login session; the 12-hour lifetime; the protocol is not in npm's OpenAPI spec.
3. **Org creation.**
   - Poll every 5 seconds or slower, with a bound.
   - A 200 `{}` means a new empty org.
   - Check `/-/org/<scope>/user` to tell an org from a user name.
   - UNVERIFIED: whether 2FA or a verified email is needed, and how soon the scope appears.
4. **Placeholder.** One stage call creates the package and a public `0.0.0-stage` stub, and the stub takes `latest`.
   - The body is a normal publish body: base64 tarball, sha512 integrity, sha1 shasum. `bun pm pack` can make the tarball. Running `npm stage publish` through `bunx npm@12.2.0` is the other way; under Bun it is UNVERIFIED.
   - The staged version stays in the queue. A staged `0.1.0` blocks CI from publishing `0.1.0` until someone approves or rejects it, and both need 2FA.
   - **Open for the spec** (ADR-0006 does not say): which version the stage call submits, and whether the CLI approves it, rejects it, or leaves it.
     - Peter's 2026-10-20 path for design-system-react staged the real `0.3.0` from CI (with provenance) and approved it.
     - A rejected version number can be staged again.
   - UNVERIFIED: what a reject does to the placeholder; whether the registry accepts a body built by fetch.
5. **Trusted publisher.** One POST with the web 2FA retry.
   - Repository: the package's repo. File: the workflow file in that repo that starts the run, even when it calls a reusable workflow in `acmelabs-15/.github`. Both workflows need `id-token: write`.
   - `repository.url` must match exactly. Add `environment` only when the publish job uses one.
   - Permissions for ADR-0006: `["createPackage", "createStagedPackage"]`. Add `"manageDistTags"` only if CI must move tags.
   - CI must publish within 48 hours.
   - A non-terminal npm CLI cannot do the 2FA step, but the CLI's own fetch can.
   - UNVERIFIED: a reusable-workflow publish for an acmelabs package; a direct OIDC publish when the only version is the stub; the `www-authenticate` header on the web 401.
