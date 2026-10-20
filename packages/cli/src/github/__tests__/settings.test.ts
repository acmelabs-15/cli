import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { ProgressUpdate } from "../../command/command";
import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import { ownerSchema, repoNameSchema } from "../names";
import { ensureActionsSetting } from "../settings";
import { frontEnd, ghAnswers, ghLogged, ghScripted } from "./gh-answers";

/** A sample command that gives a GitHub repo the Actions setting. */
const actionsSettingCommand = defineCommand({
  path: ["sample", "actions-setting"],
  summary: "Give a GitHub repo the Actions setting.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
  }),
  run(input, context) {
    return ensureActionsSetting(context, input);
  },
});

/** The Actions setting's step for a repo, with one status. */
function settingStep(
  repo: string,
  status: "started" | "done" | "failed" | "skipped",
  detail?: string,
): ProgressUpdate {
  const step = {
    kind: "step",
    step: "github-actions-setting",
    title: `Set the Actions setting on ${repo}`,
    status,
  } as const;
  return detail === undefined ? step : { ...step, detail };
}

/** The Actions setting's API path for a repo. */
function settingPath(repo: string): string {
  return `repos/${repo}/actions/permissions/workflow`;
}

/** The GET and the PUT of acmelabs-15/skills's setting; the PUT's body as gh reads it on stdin. */
const skills = {
  read: { path: settingPath("acmelabs-15/skills") },
  write: {
    method: "PUT",
    path: settingPath("acmelabs-15/skills"),
    stdin: '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}',
  },
} as const;

describe("ensureActionsSetting", () => {
  test("a repo that has the setting gives a skipped step, and only the GET", async () => {
    const read = { path: settingPath("acmelabs-15/brain") };
    const world = fakeWorld({ spawn: [ghScripted(read, ghAnswers.actionsSetting)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acmelabs-15", name: "brain" },
      caller,
    );
    expect(outcome).toEqual({
      ok: true,
      command: "sample actions-setting",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: "skipped",
    });
    expect(caller.updates).toEqual([
      settingStep("acmelabs-15/brain", "started"),
      settingStep("acmelabs-15/brain", "skipped", "already set"),
    ]);
    expect(world.calls).toEqual([ghLogged(read)]);
  });

  test("a repo with another setting gets a PUT with the setting as its body, and a done step", async () => {
    const { read, write } = skills;
    const world = fakeWorld({
      spawn: [
        ghScripted(read, ghAnswers.actionsSettingNoApproval),
        ghScripted(write, ghAnswers.noContent),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acmelabs-15", name: "skills" },
      caller,
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: "done" });
    expect(caller.updates).toEqual([
      settingStep("acmelabs-15/skills", "started"),
      settingStep("acmelabs-15/skills", "done"),
    ]);
    expect(world.calls).toEqual([ghLogged(read), ghLogged(write)]);
  });

  test("a setting that GitHub answers with something other than the setting gets the PUT too", async () => {
    const { read, write } = skills;
    const world = fakeWorld({
      spawn: [
        ghScripted(read, {
          code: 0,
          stdout: '{"default_workflow_permissions":"write"}',
          stderr: "",
        }),
        ghScripted(write, ghAnswers.noContent),
      ],
    });
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acmelabs-15", name: "skills" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: "done" });
    expect(world.calls).toEqual([ghLogged(read), ghLogged(write)]);
  });

  test("a 409 on the PUT ends with exit 1, naming the organization's Actions settings page", async () => {
    const { read, write } = skills;
    const world = fakeWorld({
      spawn: [
        ghScripted(read, ghAnswers.actionsSettingNoApproval),
        ghScripted(write, ghAnswers.actionsSettingForbidden),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acmelabs-15", name: "skills" },
      caller,
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample actions-setting",
      exitCode: 1,
      durationMs: expect.any(Number),
      error: {
        kind: "problem",
        message:
          'the acmelabs-15 organization forbids the Actions setting on acmelabs-15/skills; an owner of the organization turns on "Allow GitHub Actions to create and approve pull requests" at https://github.com/organizations/acmelabs-15/settings/actions, then runs the command again',
        issues: [],
      },
    });
    expect(caller.updates).toEqual([
      settingStep("acmelabs-15/skills", "started"),
      settingStep("acmelabs-15/skills", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(read), ghLogged(write)]);
  });

  test("a 404 on the GET ends the step as failed with exit 2, and makes no PUT", async () => {
    const read = { path: settingPath("acmelabs-15/nope") };
    const world = fakeWorld({ spawn: [ghScripted(read, ghAnswers.notFound)] });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acmelabs-15", name: "nope" },
      caller,
    );
    expect(outcome).toMatchObject({ ok: false, exitCode: 2, error: { kind: "input" } });
    expect(caller.updates).toEqual([
      settingStep("acmelabs-15/nope", "started"),
      settingStep("acmelabs-15/nope", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(read)]);
  });
});

describe("ensureActionsSetting: the name check, before any call", () => {
  /** The rule each owner must pass, as an issue's message gives it after the owner. */
  const ownerRule =
    "is not a GitHub owner; an owner is 1 to 39 letters, digits or hyphens, and starts with a letter or digit";
  /** The rule each repo name must pass, as an issue's message gives it after the name. */
  const nameRule =
    'is not a GitHub repo name; a name is 1 to 100 letters, digits, ".", "_" or "-", and is not "." or ".."';

  test.each([
    ["a slash", "acmelabs-15/x"],
    ["..", ".."],
    ["an encoded slash", "acmelabs%2F15"],
    ["a space", "acmelabs 15"],
    ["a newline", "acmelabs\n15"],
    ["a newline at the end", "acmelabs-15\n"],
    ["a fullwidth letter", "ａcmelabs-15"],
    ["a hyphen first", "-acmelabs"],
    ["no characters", ""],
    ["40 characters", "a".repeat(40)],
    ["a dot", "acmelabs.15"],
  ])("an owner with %s ends with exit 2, and makes no call", async (_case, owner) => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(actionsSettingCommand, { owner, name: "cli" }, caller);
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message: `${JSON.stringify(`${owner}/cli`)} is not a GitHub repo`,
        issues: [{ field: "owner", message: `${JSON.stringify(owner)} ${ownerRule}` }],
      },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test.each([
    ["a slash", "cli/actions"],
    [".", "."],
    ["..", ".."],
    ["an encoded slash", "..%2F..%2Fuser"],
    ["a space", "my cli"],
    ["a newline", "cli\nx"],
    ["a newline at the end", "cli\n"],
    ["a Kelvin sign", "Kelvin"],
    ["a question mark", "cli?x=1"],
    ["no characters", ""],
    ["101 characters", "a".repeat(101)],
  ])("a repo name with %s ends with exit 2, and makes no call", async (_case, name) => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(actionsSettingCommand, { owner: "acmelabs-15", name }, caller);
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message: `${JSON.stringify(`acmelabs-15/${name}`)} is not a GitHub repo`,
        issues: [{ field: "name", message: `${JSON.stringify(name)} ${nameRule}` }],
      },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("an owner and a name that both fail give one issue each", async () => {
    const world = fakeWorld();
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acme labs", name: ".." },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        issues: [
          { field: "owner", message: `"acme labs" ${ownerRule}` },
          { field: "name", message: `".." ${nameRule}` },
        ],
      },
    });
    expect(world.calls).toEqual([]);
  });

  test("a command whose input checks the names with the two schemas ends with exit 2 before its run", async () => {
    const checked = defineCommand({
      ...actionsSettingCommand,
      input: z.object({
        owner: ownerSchema.describe("The repo's owner, such as acmelabs-15."),
        name: repoNameSchema.describe("The repo's name."),
      }),
    });
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(checked, { owner: "acmelabs-15", name: "../user" }, caller);
    expect(outcome).toMatchObject({
      exitCode: 2,
      error: {
        kind: "input",
        message: "1 input is not valid",
        issues: [{ field: "--name", message: `"../user" ${nameRule}` }],
      },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("the longest owner and name, and a name such as .github, pass the check", async () => {
    const owner = `9${"a-".repeat(19)}`;
    const name = `.github_${"x".repeat(92)}`;
    const read = { path: settingPath(`${owner}/${name}`) };
    const world = fakeWorld({ spawn: [ghScripted(read, ghAnswers.actionsSetting)] });
    const outcome = await runCommand(actionsSettingCommand, { owner, name }, frontEnd(world));
    expect(owner).toHaveLength(39);
    expect(name).toHaveLength(100);
    expect(outcome).toMatchObject({ ok: true, result: "skipped" });
    expect(world.calls).toEqual([ghLogged(read)]);
  });
});
