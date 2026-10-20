# npm scope, login, first publish and trusted publishing

What this is: research on the npm setup step in `acmelabs new`: creating a scope, detecting state, logging in, the first publish of a new package, and the trusted-publisher setup. Researched on 2026-10-20. Produced by a research agent of the spec session, read-only: it logged in to nothing and changed nothing on npm or GitHub. Sources: the npm 12.2.0 source, the npm OpenAPI spec (api-docs.npmjs.com), Bun 1.4.0 run locally, and unauthenticated curl.

## 1. Creating an org

- **The website is the only way.** `npm org` has only `set`, `rm` and `ls`, and they manage members (docs.npmjs.com/cli/v11/commands/npm-org). In npm 12.2.0, libnpmorg calls only `/-/org/{org}/user`. The registry spec has no path that creates an org.
- **Steps:** avatar → "Add an Organization" → the name becomes the scope → pick the "Unlimited public packages" plan (docs.npmjs.com/creating-an-organization). An org that publishes only public packages is free (docs.npmjs.com/organizations).
- **Start URL:** https://www.npmjs.com/org/create (npm.github.io/orgs-docs/getting-started.html). UNVERIFIED today: curl gets 403 from bot protection.
- **Open and poll:** yes. Open the URL, then poll `GET registry.npmjs.org/-/org/<scope>/package` until it changes from 404 to 200. Poll slowly: a 429 (Cloudflare 1015) came back during testing.

## 2. Detecting state (curl results)

- **(a) Scope exists:**
  - A free name returns 404 `{"error":"Scope not found"}`.
  - `/-/org/acmelabs/package` returns 200 `{"@acmelabs/design-system":"write"}`.
  - Caveat: a user scope also returns 200 (`/-/org/loriensleafs/package`).
  - To tell a user from an org without auth, `/-/org/<x>/user` returns `{"loriensleafs":"owner"}` for the user and `{}` for the org (members hidden). This is observed behaviour, not documented.
- **(b) User can publish:** `GET /-/whoami`, then `GET /-/org/acmelabs/user` with the token (spec: getOrgMembership). Owner, admin and member can all "create and publish packages in the organization scope" (docs.npmjs.com/organization-roles-and-permissions). CLI forms: `npm org ls acmelabs loriensleafs`, `npm access list packages @acmelabs`.
- **(c) Name is free:** `GET /@acmelabs%2f<name>` returns 404 `{"error":"Not found"}`.

## 3. Logging in without the npm CLI

- **Protocol** (npm-profile `lib/index.js`, shipped in npm 12.2.0):
  1. `POST /-/v1/login` returns `{loginUrl, doneUrl}`.
  2. Poll `doneUrl`. 202 with `retry-after` means wait. 200 `{token}` means done.
  3. A 4xx or 500 on the POST means web login is not supported.
- **Documented?** No: the API spec has no `/-/v1/login`. The user-facing flow is at docs.npmjs.com/accessing-npm-using-2fa. In practice it is stable: it is npm's default (`auth-type=web`), and Yarn Berry and Verdaccio implement the same flow (verdaccio.org/docs/web-login).
- **Token:** a session token that does not show in token lists, with 2FA enforced on publish. The official lifetime is 2 h (github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-…). An npm staff quote says 12 h from 2025-12-12 (socket.dev/blog/npm-to-implement-staged-publishing). The original comment was not found, so 12 h is UNVERIFIED.
- **Web 2FA for later calls (documented):**
  1. Send the request without `npm-otp`, with headers `npm-auth-type: web` and `npm-command: <cmd>`.
  2. The answer is 401 `{authUrl, doneUrl}`. Poll `doneUrl` to get the OTP.
  3. Retry with the `npm-otp` header.
  Sources: the spec's trust 401 example and npm's `lib/utils/auth.js`.
- **Bun 1.4.0:**
  - `bun login` is "reserved for future use" (run locally).
  - `bun publish` supports `--auth-type web` (the default), `legacy` and `--otp`. It reads `.npmrc`, `bunfig.toml` and `NPM_CONFIG_TOKEN` (bun.com/docs/pm/cli/publish).
  - `bun pm whoami` exists.
  - There is no stage, trust, OIDC or provenance support.

## 4. First publish of a new scoped package

- Set `"publishConfig":{"access":"public"}`. Both `bun publish` and npm read it.
- With a session token, `bun publish` and `npm publish` both need 2FA. New packages get 2FA enforcement by default (2025-12-09 changelog).
- **OIDC cannot create a package.** A trust config needs an existing package, so the first OIDC publish fails with 404 (npm/cli#8544 is still open).
- **New since 2026-10-02:** `npm stage publish` can create a package with a session token or any GAT, including stage-only.
  - It publishes a public placeholder `0.0.0-stage`.
  - The real first version waits for approval with 2FA.
  - Sources: github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages and docs.npmjs.com/staged-publishing. Endpoint: `POST /-/stage/package/{name}`.
- GATs with bypass-2FA can still publish directly; npm targets January 2027 to remove that (github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation). Creating any GAT needs interactive 2FA.

## 5. Trusted publisher

- **Versions:** `npm trust` arrived in npm 11.10.0 (it is absent in 11.9.0 on unpkg). `--allow-publish` and `--allow-stage-publish` arrived in 11.15.0, and at least one is required (grep of unpkg 11.14.0 vs 11.15.0, and npm 12.2.0 `trust-cmd.js`).
- **Syntax:** `npm trust github @acmelabs/foo --repo owner/repo --file publish.yml [--env name] --allow-publish --allow-stage-publish --yes`. `--file` takes the filename only, not a path.
- **Prerequisites:** the package exists, you have write access, 2FA is on for the account, and you do not use a bypass-2FA GAT or basic auth (docs.npmjs.com/cli/v11/commands/npm-trust).
- **Endpoint (documented, OTP required):**
  - `POST /-/package/{pkg}/trust` with body `[{"type":"github","claims":{"repository":"o/r","workflow_ref":{"file":"publish.yml"},"environment":"x"},"permissions":["createPackage","createStagedPackage"]}]`
  - `GET` on the same path lists configs; `DELETE …/trust/{uuid}` removes one.
  - Bun can call these with fetch. The `manageDistTags` permission exists only in the API; npm 12.2.0 has no flag for it.
- **Defaults:** configs created after 2026-09-03 allow only `npm stage publish`. Direct `npm publish` is opt-in (`createPackage`) (docs.npmjs.com/trusted-publishers).
- **Expiry:** an unvalidated config expires 48 h after creation. The first successful publish validates it (github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire).
- **Doc drift:** the npm-trust page still says "one configuration per package". The real limit is 10 since 2026-09-03.
- **CI requirements:** npm 11.5.1 or later (11.15.0 for stage), Node 22.14 or later, and `id-token: write`. `bun publish` has no OIDC support (oven-sh/bun#22423 and #15601 are open). The usual pattern is `bun pm pack`, then `npm publish <tgz>`.

## 6. Bun alone versus the npm CLI

| Step | Runs under Bun alone? |
|---|---|
| Scope, name and membership checks | Yes, with fetch |
| Web login | Yes, with fetch (protocol not documented) |
| Direct publish | Yes, `bun publish` plus OTP |
| Stage publish to create the package | Fetch to the documented endpoint, or the npm CLI |
| Trust config | Fetch to the documented endpoint, or npm 11.15 or later |
| OIDC publish in CI | npm CLI |
| Org creation | Browser only |

Verified: npm 12.2.0 runs under Bun 1.4.0 with no Node on PATH. The commands that ran were `env -i PATH=~/.bun/bin:/usr/bin:/bin bunx npm@12.2.0 --version` (prints 12.2.0), plus `npm view` and `npm trust github --help`. `npm login`, `publish` and `trust` under Bun are UNVERIFIED.

## End-to-end path a CLI can automate

1. Check that the name is free and whether the scope exists. **automatable**
2. If the scope returns 404, open the org/create page and poll until it returns 200. **needs-browser**
3. Run web login to get a session token. **needs-browser**, plus **needs-user-input** (password, 2FA)
4. Check that the user is an org member. **automatable**
5. Scaffold `publishConfig.access`, `repository.url`, and a `publish.yml` with `id-token: write` and npm 11.15 or later. **automatable**
6. Push the repo. **automatable** (an outward step: ask once)
7. Do the first publish: either `bun publish` with 2FA, or a stage publish that creates the package (no 2FA at this step). **needs-user-input**
8. Send the trust POST. **needs-user-input** (web 2FA or OTP)
9. Run the CI publish within 48 h. **automatable**
10. If step 7 used staging, approve the staged version with 2FA. **needs-user-input**

## Choices this research left open, since settled

| Choice | Options | Settled on 2026-10-20 |
|---|---|---|
| First publish | Direct publish, or a stage publish that leaves a public `0.0.0-stage` placeholder | Placeholder, then CI: the real 0.1.0 publishes from CI with provenance |
| Trust permissions | `--allow-publish`, or stage-only (every release needs a 2FA approval) | Direct publish |
