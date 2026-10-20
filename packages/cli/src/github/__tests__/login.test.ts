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

  test("an active account in the state error ends with exit 4 naming gh auth login, though another account is fine", async () => {
    const world = fakeWorld({ spawn: [statusScripted(statusAnswers.badEnvToken)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(loginCommand, { scopes: ["repo", "workflow"] }, caller);
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 4,
      error: {
        kind: "login",
        message: "gh needs a login; run gh auth login, then run the command again",
      },
    });
    expect(caller.updates).toEqual([loginStep("started"), loginStep("failed")]);
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

  test("a gh without --json for auth status ends with exit 3, naming the command and gh's stderr", async () => {
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
          "gh auth status --hostname github.com --json hosts failed with exit 1: unknown flag: --json\n\nUsage:  gh auth status [flags]",
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

  test("a token from GH_TOKEN is the active account, and the step checks it like any other", async () => {
    // Built: as badEnvToken, with a token in GH_TOKEN that GitHub accepts. Its scopes, not the
    // keyring login's, decide the check: every gh call and gh's git helper use that token.
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
          "gh needs a login; run gh auth refresh -h github.com -s workflow, then run the command again",
      },
    });
  });
});
