import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { ProgressUpdate } from "../../command/command";
import { defineCommand } from "../../command/command";
import type { WorldCall } from "../../command/fake-world";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { Spawned } from "../../command/world";
import { checkLogin } from "../login";
import { frontEnd } from "./gh-answers";

/** A sample command that checks the gh login for github.com, and the scopes it must have. */
const loginCommand = defineCommand({
  path: ["sample", "login"],
  summary: "Check the gh login for github.com.",
  input: z.object({
    scopes: z.array(z.string()).describe("The scopes the login must have, such as workflow."),
  }),
  run(input, context) {
    return checkLogin(context, { scopes: input.scopes });
  },
});

/** The command line that reads gh's login for github.com, word for word as the spec gives it. */
const statusCommandLine = ["gh", "auth", "status", "--hostname", "github.com", "--json", "hosts"];

/** fakeWorld's log entry for the read of gh's login: the command line and gh's two variables. */
const statusLogged: WorldCall = {
  kind: "spawn",
  commandLine: statusCommandLine,
  env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
};

/** A scripted answer to the read of gh's login. */
function statusScripted(answer: Spawned) {
  return { commandLine: statusCommandLine, answer };
}

/** gh's answer, exit 0, with `hosts` as its JSON on stdout. */
function statusAnswer(hosts: object): Spawned {
  return { code: 0, stdout: JSON.stringify({ hosts }), stderr: "" };
}

/**
 * Built: gh's answer for this machine's keyring login with these scopes, as gh writes them, such
 * as "gist, repo". With no scopes, the account has no `scopes` field, as gh leaves it out for a
 * token that reports none.
 */
function keyringLogin(scopes?: string): Spawned {
  const account = {
    state: "success",
    active: true,
    host: "github.com",
    login: "loriensleafs",
    tokenSource: "keyring",
    gitProtocol: "https",
  };
  return statusAnswer({ "github.com": [scopes === undefined ? account : { ...account, scopes }] });
}

/**
 * gh's answers to `gh auth status --hostname github.com --json hosts`. Each one is real, read with
 * gh 2.98.0 on 2026-10-20, unless its comment says it is built: a built answer follows the fields
 * of gh's `authEntry` (`pkg/cmd/auth/status/status.go` at v2.98.0, note 09, section 1.4).
 */
const statusAnswers = {
  /** This machine's login: a keyring token with five scopes (note 09, section 1.4). */
  loggedIn: {
    code: 0,
    stdout:
      '{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"loriensleafs","tokenSource":"keyring","scopes":"admin:public_key, gist, read:org, repo, workflow","gitProtocol":"https"}]}}\n',
    stderr: "",
  },
  /** No login at all: gh with an empty GH_CONFIG_DIR. gh exits 0 with --json. */
  loggedOut: {
    code: 0,
    stdout: '{"hosts":{}}\n',
    stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n",
  },
  /**
   * A token in GH_TOKEN that GitHub rejects, beside this machine's keyring login. The token from
   * GH_TOKEN is the active account, the one that every gh call uses; the keyring login is not.
   */
  badEnvToken: {
    code: 0,
    stdout: `${String.raw`{"hosts":{"github.com":[{"state":"error","error":"non-200 OK status code: 401 Unauthorized body: \"{\\r\\n  \\\"message\\\": \\\"Bad credentials\\\",\\r\\n  \\\"documentation_url\\\": \\\"https://docs.github.com/rest\\\",\\r\\n  \\\"status\\\": \\\"401\\\"\\r\\n}\"","active":true,"host":"github.com","login":"","tokenSource":"GH_TOKEN","gitProtocol":"https"},{"state":"success","active":false,"host":"github.com","login":"loriensleafs","tokenSource":"keyring","scopes":"admin:public_key, gist, read:org, repo, workflow","gitProtocol":"https"}]}}`}\n`,
    stderr: "",
  },
} satisfies Record<string, Spawned>;

/** The login step, with one status. */
function loginStep(
  status: "started" | "done" | "failed" | "skipped",
  detail?: string,
): ProgressUpdate {
  const step = {
    kind: "step",
    step: "github-login",
    title: "Check the gh login for github.com",
    status,
  } as const;
  return detail === undefined ? step : { ...step, detail };
}

describe("checkLogin", () => {
  test("logged in with repo and workflow gives a done step and the login with its scopes", async () => {
    const world = fakeWorld({ spawn: [statusScripted(statusAnswers.loggedIn)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toEqual({
      ok: true,
      command: "sample login",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: {
        login: "loriensleafs",
        scopes: ["admin:public_key", "gist", "read:org", "repo", "workflow"],
      },
    });
    expect(caller.updates).toEqual([
      loginStep("started"),
      loginStep("done", "loriensleafs, with admin:public_key, gist, read:org, repo, workflow"),
    ]);
    expect(world.calls).toEqual([statusLogged]);
  });

  test("gh's scopes show on one line in the done step's detail; the result keeps them as gh gives them", async () => {
    // Built: gh's scopes text comes from GitHub's X-OAuth-Scopes header (note 09, section 1.4).
    const world = fakeWorld({
      spawn: [statusScripted(keyringLogin("gist\u001B[2J, repo, workflow"))],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toMatchObject({
      ok: true,
      result: { login: "loriensleafs", scopes: ["gist\u001B[2J", "repo", "workflow"] },
    });
    expect(caller.updates).toEqual([
      loginStep("started"),
      loginStep("done", "loriensleafs, with gist [2J, repo, workflow"),
    ]);
  });

  test("a token that reports no scopes passes, as gh skips its own scope check for one", async () => {
    // A fine-grained or app token has permissions, not scopes (note 09, section 1.4).
    const world = fakeWorld({ spawn: [statusScripted(keyringLogin())] });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toMatchObject({
      ok: true,
      exitCode: 0,
      result: { login: "loriensleafs", scopes: [] },
    });
    expect(caller.updates).toEqual([
      loginStep("started"),
      loginStep("done", "loriensleafs, with a token that reports no scopes"),
    ]);
    expect(world.calls).toEqual([statusLogged]);
  });
});

describe("checkLogin: a login is needed", () => {
  test("no account ends with exit 4 naming gh auth login, and the step fails", async () => {
    const world = fakeWorld({ spawn: [statusScripted(statusAnswers.loggedOut)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample login",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([loginStep("started"), loginStep("failed")]);
    expect(world.calls).toEqual([statusLogged]);
  });

  test("a keyring login in the state error ends with exit 4 naming gh auth login, then gh's own error", async () => {
    // Built: a keyring token that GitHub rejects. gh's error is go-gh's HTTPError text for its
    // GET of the API root (`GetScopes` in oauth_scopes.go; errors.go at go-gh v2.13.0).
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "error",
                error: "HTTP 401: Bad credentials (https://api.github.com/)",
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "keyring",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample login",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth login, then run the command again: HTTP 401: Bad credentials (https://api.github.com/)",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([loginStep("started"), loginStep("failed")]);
    expect(world.calls).toEqual([statusLogged]);
  });

  test("gh's error shows on one line and stops at 300 characters, as a proxy's long page can fill it", async () => {
    // Built: go-gh's HTTPError text puts a second line of the answer after a line break.
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "error",
                error: `HTTP 502: Bad Gateway (https://api.github.com/)\r\n${"<p>".repeat(200)}`,
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "keyring",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    // The first 300 characters: the 47 of the first line, one space, then 252 of the 600 of
    // "<p>", a part of a word, which is dropped.
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth login, then run the command again: HTTP 502: Bad Gateway (https://api.github.com/)...",
      },
    });
  });

  test("gh's error of only a line break adds no reason to the message", async () => {
    // Built: gh leaves out an empty error, but not one of only control characters.
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "error",
                error: "\r\n",
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "keyring",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
      },
    });
  });

  test("a token from GH_TOKEN in the state error ends with exit 4 naming GH_TOKEN, gh auth login and gh's error, though the keyring login is fine", async () => {
    // gh auth login refuses to run while GH_TOKEN is set (note 09, section 1.4), so the message
    // names the variable: replace its token, or clear it first.
    const world = fakeWorld({ spawn: [statusScripted(statusAnswers.badEnvToken)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample login",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message: String.raw`gh needs a login; replace the token in GH_TOKEN, or clear GH_TOKEN and run gh auth login, then run the command again: non-200 OK status code: 401 Unauthorized body: "{\r\n  \"message\": \"Bad credentials\",\r\n  \"documentation_url\": \"https://docs.github.com/rest\",\r\n  \"status\": \"401\"\r\n}"`,
        issues: [],
      },
    });
    expect(caller.updates).toEqual([loginStep("started"), loginStep("failed")]);
    expect(world.calls).toEqual([statusLogged]);
  });

  test("a token from GH_TOKEN beside a set GITHUB_TOKEN names both to clear: gh reads GITHUB_TOKEN once GH_TOKEN is cleared", async () => {
    // gh reads GH_TOKEN first (note 09, section 1.2), and refuses gh auth login while its token
    // comes from either variable (section 1.4).
    const world = fakeWorld({
      env: { GH_TOKEN: "not-a-real-token", GITHUB_TOKEN: "also-not-a-real-token" },
      spawn: [statusScripted(statusAnswers.badEnvToken)],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message: String.raw`gh needs a login; replace the token in GH_TOKEN, or clear both GH_TOKEN and GITHUB_TOKEN and run gh auth login, then run the command again: non-200 OK status code: 401 Unauthorized body: "{\r\n  \"message\": \"Bad credentials\",\r\n  \"documentation_url\": \"https://docs.github.com/rest\",\r\n  \"status\": \"401\"\r\n}"`,
      },
    });
  });

  test("a token from GITHUB_TOKEN in the state error names GITHUB_TOKEN", async () => {
    // Built: as badEnvToken, with the token in GITHUB_TOKEN and no keyring login, as in CI.
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "error",
                error: "non-200 OK status code: 401 Unauthorized body: ...",
                active: true,
                host: "github.com",
                login: "",
                tokenSource: "GITHUB_TOKEN",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; replace the token in GITHUB_TOKEN, or clear GITHUB_TOKEN and run gh auth login, then run the command again: non-200 OK status code: 401 Unauthorized body: ...",
      },
    });
  });
});

describe("checkLogin: a scope that the login lacks", () => {
  test("a token without workflow ends with exit 4 naming gh auth refresh with workflow, and the step fails", async () => {
    const world = fakeWorld({
      spawn: [statusScripted(keyringLogin("admin:public_key, gist, read:org, repo"))],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample login",
      exitCode: 4,
      durationMs: expect.any(Number),
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s workflow, then run the command again",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([loginStep("started"), loginStep("failed")]);
    expect(world.calls).toEqual([statusLogged]);
  });

  test("a token without either asked scope gets one command line for both, in the asked order", async () => {
    // gh auth refresh's --scopes takes a list with commas (refresh.go at v2.98.0).
    const world = fakeWorld({ spawn: [statusScripted(keyringLogin("gist, read:org"))] });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s repo,workflow, then run the command again",
      },
    });
  });
});

describe("checkLogin: a scope that includes another", () => {
  // GitHub saves a token's scopes without those that another of its scopes includes, so a token
  // with repo lists repo alone, never public_repo ("Scopes for OAuth apps", "Normalized scopes").
  test.each([
    ["public_repo", "repo", "gist, read:org, repo"],
    ["read:org", "admin:org", "admin:org, repo"],
    ["read:org", "write:org", "repo, write:org"],
  ])("a check for %s passes on a token with %s", async (asked, _wider, tokenScopes) => {
    const world = fakeWorld({ spawn: [statusScripted(keyringLogin(tokenScopes))] });
    const outcome = await runCommand(loginCommand, { scopes: [asked] }, frontEnd(world));
    expect(outcome).toMatchObject({ ok: true, result: { login: "loriensleafs" } });
  });

  test("a check for repo fails on a token with only public_repo: public_repo is the narrower scope", async () => {
    const world = fakeWorld({
      spawn: [statusScripted(keyringLogin("gist, public_repo, read:org, workflow"))],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s repo, then run the command again",
      },
    });
  });
});

describe("checkLogin: an outside failure, exit 3", () => {
  test("an active account in the state timeout ends with exit 3, naming the command and gh's error", async () => {
    // Built: gh gives the state timeout only when its request to GitHub times out (status.go).
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "timeout",
                error:
                  'Get "https://api.github.com/": context deadline exceeded (Client.Timeout exceeded while awaiting headers)',
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "keyring",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample login",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          'gh auth status --hostname github.com --json hosts timed out on its way to GitHub; check the network, then run the command again: Get "https://api.github.com/": context deadline exceeded (Client.Timeout exceeded while awaiting headers)',
        issues: [],
      },
    });
    expect(caller.updates).toEqual([loginStep("started"), loginStep("failed")]);
  });

  test("a gh without --json for auth status ends with exit 3, naming the command and gh's stderr on one line", async () => {
    // Built: gh's answer to a flag it does not know, as an older gh gives for --json here.
    const world = fakeWorld({
      spawn: [
        statusScripted({
          code: 1,
          stdout: "",
          stderr: "unknown flag: --json\n\nUsage:  gh auth status [flags]\n",
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toEqual({
      ok: false,
      command: "sample login",
      exitCode: 3,
      durationMs: expect.any(Number),
      error: {
        kind: "outside",
        message:
          "gh auth status --hostname github.com --json hosts failed with exit 1: unknown flag: --json Usage:  gh auth status [flags]",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([loginStep("started"), loginStep("failed")]);
  });

  test("an answer that is not JSON ends with exit 3, naming the command", async () => {
    const world = fakeWorld({
      spawn: [statusScripted({ code: 0, stdout: "github.com\n  ✓ Logged in\n", stderr: "" })],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh auth status --hostname github.com --json hosts gave an answer that is not JSON",
      },
    });
  });

  test("an answer of another shape ends with exit 3, naming the command and the first thing wrong", async () => {
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({ "github.com": { state: "success", active: true, login: "loriensleafs" } }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          'gh auth status --hostname github.com --json hosts gave an answer that acmelabs cannot read: hosts["github.com"]: Invalid input: expected array, received object',
        issues: [
          {
            field: 'hosts["github.com"]',
            message: "Invalid input: expected array, received object",
          },
        ],
      },
    });
  });

  test("gh's host name inside a thing wrong with its answer shows on one line, in the message and in the issue", async () => {
    // Built: a host name is a key of gh's answer, so the place of a thing wrong holds gh's text.
    const world = fakeWorld({
      spawn: [statusScripted(statusAnswer({ "git\u202Ehub.com": "no list" }))],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          'gh auth status --hostname github.com --json hosts gave an answer that acmelabs cannot read: hosts["git hub.com"]: Invalid input: expected array, received string',
        issues: [
          {
            field: 'hosts["git hub.com"]',
            message: "Invalid input: expected array, received string",
          },
        ],
      },
    });
  });

  test("gh not installed ends with exit 3, naming gh", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: statusCommandLine, missing: true }] });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 3,
      error: { kind: "outside", message: "gh is not installed or not on PATH" },
    });
  });
});

describe("checkLogin: gh's exit 4", () => {
  test("gh's exit 4, a command that needs a login, ends with exit 4 naming gh auth login", async () => {
    // gh's documented exit code for "a command requires authentication" (note 09, section 1.3).
    const world = fakeWorld({
      spawn: [
        statusScripted({
          code: 4,
          stdout: "",
          stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
        }),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
      },
    });
  });
});

describe("checkLogin: the active account", () => {
  test("an account that is not active plays no part: its state of error does not stop the step", async () => {
    // Built: two keyring accounts, as after a second gh auth login. gh lists the active account
    // first; here it comes second, so the step must pick it by `active`, not by its place.
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "error",
                error: "non-200 OK status code: 401 Unauthorized",
                active: false,
                host: "github.com",
                login: "acmelabs-bot",
                tokenSource: "keyring",
                gitProtocol: "https",
              },
              {
                state: "success",
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "keyring",
                scopes: "repo, workflow",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: true,
      result: { login: "loriensleafs", scopes: ["repo", "workflow"] },
    });
  });

  test("a token from GH_TOKEN is the active account: a scope it lacks names GH_TOKEN, then gh auth refresh after it is cleared", async () => {
    // Built: as badEnvToken, with a token in GH_TOKEN that GitHub accepts. Its scopes, not the
    // keyring login's, decide the check: every gh call and gh's git helper use that token. gh
    // auth refresh refuses to run while GH_TOKEN is set (note 09, section 1.4).
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "success",
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "GH_TOKEN",
                scopes: "gist, read:org, repo",
                gitProtocol: "https",
              },
              {
                state: "success",
                active: false,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "keyring",
                scopes: "admin:public_key, gist, read:org, repo, workflow",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; give the workflow scope to the token in GH_TOKEN, or clear GH_TOKEN and run gh auth refresh -h github.com -s workflow, then run the command again",
      },
    });
  });

  test("a token from GITHUB_TOKEN that lacks both asked scopes names both, and GITHUB_TOKEN", async () => {
    // Built: a classic token in GITHUB_TOKEN, with no keyring login.
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "success",
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "GITHUB_TOKEN",
                scopes: "gist, read:org",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; give the repo and workflow scopes to the token in GITHUB_TOKEN, or clear GITHUB_TOKEN and run gh auth refresh -h github.com -s repo,workflow, then run the command again",
      },
    });
  });

  test("a token source that is no variable of gh's names gh auth refresh alone", async () => {
    // Built: a token from gh's hosts.yml, whose tokenSource is the file's path (buildEntry).
    const world = fakeWorld({
      spawn: [
        statusScripted(
          statusAnswer({
            "github.com": [
              {
                state: "success",
                active: true,
                host: "github.com",
                login: "loriensleafs",
                tokenSource: "/Users/loriensleafs/.config/gh/hosts.yml",
                scopes: "gist, read:org, repo",
                gitProtocol: "https",
              },
            ],
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      loginCommand,
      { scopes: ["repo", "workflow"] },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 4,
      error: {
        kind: "login",
        message:
          "gh needs a login; run gh auth refresh -h github.com -s workflow, then run the command again",
      },
    });
  });
});
