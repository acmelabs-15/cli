import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { ProgressUpdate } from "../../command/command";
import { defineCommand } from "../../command/command";
import { fakeWorld } from "../../command/fake-world";
import { runCommand } from "../../command/run";
import type { Spawned } from "../../command/world";
import { ownerSchema, repoNameSchema } from "../names";
import { ensureActionsSetting, ensureProtectMain } from "../settings";
import {
  frontEnd,
  ghAnswers,
  ghLogged,
  ghLoggedEveryTry,
  ghScripted,
  ghScriptedEveryTry,
} from "./gh-answers";

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

  test("an answer that leaves out a field of the setting gets the PUT too", async () => {
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

  test("an answer with a field of another type ends with exit 3, naming the call, and makes no PUT", async () => {
    const { read } = skills;
    const world = fakeWorld({
      spawn: [
        ghScripted(read, {
          code: 0,
          stdout:
            '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":"true"}',
          stderr: "",
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acmelabs-15", name: "skills" },
      caller,
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/skills/actions/permissions/workflow gave an answer that acmelabs cannot read: can_approve_pull_request_reviews: Invalid input: expected boolean, received string",
      },
    });
    expect(caller.updates).toEqual([
      settingStep("acmelabs-15/skills", "started"),
      settingStep("acmelabs-15/skills", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(read)]);
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

  test("a 404 on the GET that stays after every try ends the step as failed with exit 2, and makes no PUT", async () => {
    const read = { path: settingPath("acmelabs-15/nope") };
    const world = fakeWorld({ spawn: ghScriptedEveryTry(read, ghAnswers.notFound) });
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
    expect(world.calls).toEqual(ghLoggedEveryTry(read));
  });
});

describe("ensureActionsSetting: an unexpected 404 or 409 is tried again", () => {
  test("a 404, then a 200 with another setting, on the GET gives a done step after one 3-second wait", async () => {
    // Right after a create, GitHub can answer 404 for a few seconds (note 09, section 3.1).
    const { read, write } = skills;
    const world = fakeWorld({
      spawn: [
        ghScripted(read, ghAnswers.notFound),
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
    expect(world.calls).toEqual([
      ghLogged(read),
      { kind: "sleep", ms: 3000 },
      ghLogged(read),
      ghLogged(write),
    ]);
  });

  test("a 404, then a 204, on the PUT gives a done step after one 3-second wait", async () => {
    // A PUT is idempotent, so a second one is safe to send.
    const { read, write } = skills;
    const world = fakeWorld({
      spawn: [
        ghScripted(read, ghAnswers.actionsSettingNoApproval),
        ghScripted(write, ghAnswers.notFound),
        ghScripted(write, ghAnswers.noContent),
      ],
    });
    const outcome = await runCommand(
      actionsSettingCommand,
      { owner: "acmelabs-15", name: "skills" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: "done" });
    expect(world.calls).toEqual([
      ghLogged(read),
      ghLogged(write),
      { kind: "sleep", ms: 3000 },
      ghLogged(write),
    ]);
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

/** A sample command that gives a GitHub repo Protect main. */
const protectMainCommand = defineCommand({
  path: ["sample", "protect-main"],
  summary: "Give a GitHub repo Protect main.",
  input: z.object({
    owner: z.string().describe("The repo's owner, such as acmelabs-15."),
    name: z.string().describe("The repo's name."),
  }),
  run(input, context) {
    return ensureProtectMain(context, input);
  },
});

/** Protect main's step for a repo, with one status. */
function protectStep(
  repo: string,
  status: "started" | "done" | "failed" | "skipped",
  detail?: string,
): ProgressUpdate {
  const step = {
    kind: "step",
    step: "github-protect-main",
    title: `Set Protect main on ${repo}`,
    status,
  } as const;
  return detail === undefined ? step : { ...step, detail };
}

/** Protect main's body as gh reads it on stdin: the body that made cli's ruleset (note 09, 5). */
const protectMainStdin =
  '{"name":"Protect main","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}],"bypass_actors":[]}';

/**
 * The calls of Protect main's step on a repo: the list of its own rulesets, the GET and the PUT of
 * ruleset 25457893, brain's "Protect main", and the POST.
 */
function protectCalls(repo: string) {
  return {
    list: { path: `repos/${repo}/rulesets?includes_parents=false&per_page=100` },
    read: { path: `repos/${repo}/rulesets/25457893` },
    update: { method: "PUT", path: `repos/${repo}/rulesets/25457893`, stdin: protectMainStdin },
    create: { method: "POST", path: `repos/${repo}/rulesets`, stdin: protectMainStdin },
  } as const;
}

/** Built: brain's "Protect main" with some fields changed. A field set to undefined is left out. */
function brainRulesetWith(fields: Record<string, unknown>): Spawned {
  const ruleset: object = JSON.parse(ghAnswers.protectMainOfBrain.stdout);
  return { code: 0, stdout: JSON.stringify({ ...ruleset, ...fields }), stderr: "" };
}

/** Built: a list of a repo's own rulesets, in the list's shape, with these ids and names. */
function rulesetList(rulesets: readonly [id: number, name: string][]): Spawned {
  const items = rulesets.map(([id, name]) => ({
    id,
    name,
    target: "branch",
    source_type: "Repository",
    source: "acmelabs-15/brain",
    enforcement: "active",
  }));
  return { code: 0, stdout: JSON.stringify(items), stderr: "" };
}

describe("ensureProtectMain", () => {
  test("brain's ruleset gives a skipped step, and only the list and the GET", async () => {
    const { list, read } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, ghAnswers.rulesetsOfBrain),
        ghScripted(read, ghAnswers.protectMainOfBrain),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      caller,
    );
    expect(outcome).toEqual({
      ok: true,
      command: "sample protect-main",
      exitCode: 0,
      durationMs: expect.any(Number),
      result: "skipped",
    });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/brain", "started"),
      protectStep("acmelabs-15/brain", "skipped", "already set"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), ghLogged(read)]);
  });

  test("a repo with no rulesets gets a POST with Protect main as its body, and a done step", async () => {
    // acmelabs-15/cli before 2026-10-20 08:09:23, when this POST made its ruleset (note 09, 5).
    const { list, create } = protectCalls("acmelabs-15/cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, ghAnswers.noRulesets),
        ghScripted(create, ghAnswers.protectMainOfCli),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "cli" },
      caller,
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: "done" });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/cli", "started"),
      protectStep("acmelabs-15/cli", "done", "created"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), ghLogged(create)]);
  });

  test("a Protect main with a missing rule gets a PUT on its id with Protect main as its body, and a done step", async () => {
    const { list, read, update } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, ghAnswers.rulesetsOfBrain),
        ghScripted(read, brainRulesetWith({ rules: [{ type: "non_fast_forward" }] })),
        ghScripted(update, ghAnswers.protectMainOfBrain),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      caller,
    );
    expect(outcome).toMatchObject({ ok: true, exitCode: 0, result: "done" });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/brain", "started"),
      protectStep("acmelabs-15/brain", "done", "updated"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), ghLogged(read), ghLogged(update)]);
  });

  test("other rulesets get no call beyond the list: Protect main beside them is read alone", async () => {
    const { list, read } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(
          list,
          rulesetList([
            [25_400_001, "Release branches"],
            [25_457_893, "Protect main"],
            [25_400_002, "Signed commits"],
          ]),
        ),
        ghScripted(read, ghAnswers.protectMainOfBrain),
      ],
    });
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: "skipped" });
    expect(world.calls).toEqual([ghLogged(list), ghLogged(read)]);
  });

  test("other rulesets get no call beyond the list: with no Protect main, the step makes the POST", async () => {
    const { list, create } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, rulesetList([[25_400_001, "Release branches"]])),
        ghScripted(create, ghAnswers.protectMainOfBrain),
      ],
    });
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: "done" });
    expect(world.calls).toEqual([ghLogged(list), ghLogged(create)]);
  });

  test("the order of the rules, and GitHub's other fields, make no difference", async () => {
    const { list, read } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, ghAnswers.rulesetsOfBrain),
        ghScripted(
          read,
          brainRulesetWith({
            rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
            current_user_can_bypass: "always",
            source: "acmelabs-15/other",
          }),
        ),
      ],
    });
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({ ok: true, result: "skipped" });
    expect(world.calls).toEqual([ghLogged(list), ghLogged(read)]);
  });

  test.each([
    ["target", { target: "tag" }],
    ["enforcement", { enforcement: "disabled" }],
    ["included refs", { conditions: { ref_name: { include: ["~ALL"], exclude: [] } } }],
    [
      "excluded refs",
      { conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: ["release"] } } },
    ],
    ["conditions, which are null", { conditions: null }],
    [
      "rule types, with one more",
      {
        rules: [
          { type: "non_fast_forward" },
          { type: "deletion" },
          { type: "required_signatures" },
        ],
      },
    ],
    [
      "bypass list",
      { bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }] },
    ],
  ])(
    "a Protect main whose %s differs gets the PUT with Protect main as its body",
    async (_field, fields) => {
      const { list, read, update } = protectCalls("acmelabs-15/brain");
      const world = fakeWorld({
        spawn: [
          ghScripted(list, ghAnswers.rulesetsOfBrain),
          ghScripted(read, brainRulesetWith(fields)),
          ghScripted(update, ghAnswers.protectMainOfBrain),
        ],
      });
      const outcome = await runCommand(
        protectMainCommand,
        { owner: "acmelabs-15", name: "brain" },
        frontEnd(world),
      );
      expect(outcome).toMatchObject({ ok: true, result: "done" });
      expect(world.calls).toEqual([ghLogged(list), ghLogged(read), ghLogged(update)]);
    },
  );

  test("a Protect main with no bypass list gets the PUT, and GitHub's refusal ends with exit 2", async () => {
    // GitHub leaves out the bypass list for a login that cannot write the ruleset (note 09, 2.6).
    const { list, read, update } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, ghAnswers.rulesetsOfBrain),
        ghScripted(
          read,
          brainRulesetWith({ bypass_actors: undefined, current_user_can_bypass: undefined }),
        ),
        // Built: GitHub refuses the PUT to a login without admin access to the repo.
        ghScripted(update, {
          code: 1,
          stdout:
            '{"message":"Must have admin rights to Repository.","documentation_url":"https://docs.github.com/rest/repos/rules#update-a-repository-ruleset","status":"403"}',
          stderr: "gh: Must have admin rights to Repository. (HTTP 403)\n",
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      caller,
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample protect-main",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          "GitHub refused PUT repos/acmelabs-15/brain/rulesets/25457893 for the gh login, which needs more access to acmelabs-15/brain (HTTP 403): Must have admin rights to Repository.",
        issues: [],
      },
    });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/brain", "started"),
      protectStep("acmelabs-15/brain", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), ghLogged(read), ghLogged(update)]);
  });

  test("two rulesets named Protect main end with exit 2, naming the ids and the rules page, and make no write", async () => {
    const { list } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(
          list,
          rulesetList([
            [25_457_893, "Protect main"],
            [25_457_999, "Protect main"],
          ]),
        ),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      caller,
    );
    expect(outcome).toEqual({
      ok: false,
      command: "sample protect-main",
      exitCode: 2,
      durationMs: expect.any(Number),
      error: {
        kind: "input",
        message:
          'acmelabs-15/brain has 2 rulesets named "Protect main" (25457893, 25457999), and acmelabs cannot tell which one to keep; remove all but one at https://github.com/acmelabs-15/brain/settings/rules, then run the command again',
        issues: [],
      },
    });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/brain", "started"),
      protectStep("acmelabs-15/brain", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(list)]);
  });

  test("a list of another shape ends with exit 3, naming the call, and makes no write", async () => {
    const { list } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({ spawn: [ghScripted(list, ghAnswers.protectMainOfBrain)] });
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/rulesets?includes_parents=false&per_page=100 gave an answer that acmelabs cannot read: Invalid input: expected array, received object",
      },
    });
    expect(world.calls).toEqual([ghLogged(list)]);
  });

  test("a ruleset id that is not a positive whole number ends with exit 3, and goes into no path", async () => {
    const { list } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [ghScripted(list, rulesetList([[-1, "Protect main"]]))],
    });
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/rulesets?includes_parents=false&per_page=100 gave an answer that acmelabs cannot read: [0].id: Too small: expected number to be >0",
      },
    });
    expect(world.calls).toEqual([ghLogged(list)]);
  });

  test("a ruleset of another shape ends with exit 3, naming the call, and makes no write", async () => {
    const { list, read } = protectCalls("acmelabs-15/brain");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, ghAnswers.rulesetsOfBrain),
        ghScripted(read, brainRulesetWith({ rules: "non_fast_forward" })),
      ],
    });
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "brain" },
      frontEnd(world),
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 3,
      error: {
        kind: "outside",
        message:
          "gh api GET repos/acmelabs-15/brain/rulesets/25457893 gave an answer that acmelabs cannot read: rules: Invalid input: expected array, received string",
      },
    });
    expect(world.calls).toEqual([ghLogged(list), ghLogged(read)]);
  });

  test("a POST that GitHub refuses ends with GitHub's answer by the table", async () => {
    const { list, create } = protectCalls("acmelabs-15/cli");
    const world = fakeWorld({
      spawn: [
        ghScripted(list, ghAnswers.noRulesets),
        // Built: GitHub refuses the POST to a login without admin access to the repo.
        ghScripted(create, {
          code: 1,
          stdout:
            '{"message":"Must have admin rights to Repository.","documentation_url":"https://docs.github.com/rest/repos/rules#create-a-repository-ruleset","status":"403"}',
          stderr: "gh: Must have admin rights to Repository. (HTTP 403)\n",
        }),
      ],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "cli" },
      caller,
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: {
        kind: "input",
        message:
          "GitHub refused POST repos/acmelabs-15/cli/rulesets for the gh login, which needs more access to acmelabs-15/cli (HTTP 403): Must have admin rights to Repository.",
      },
    });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/cli", "started"),
      protectStep("acmelabs-15/cli", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), ghLogged(create)]);
  });

  test("a 404 on the POST is final at once, with no wait", async () => {
    // GitHub may have applied the POST, and a second one could make a second ruleset.
    const { list, create } = protectCalls("acmelabs-15/cli");
    const world = fakeWorld({
      spawn: [ghScripted(list, ghAnswers.noRulesets), ghScripted(create, ghAnswers.notFound)],
    });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "cli" },
      caller,
    );
    expect(outcome).toMatchObject({ ok: false, exitCode: 2, error: { kind: "input" } });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/cli", "started"),
      protectStep("acmelabs-15/cli", "failed"),
    ]);
    expect(world.calls).toEqual([ghLogged(list), ghLogged(create)]);
  });

  test("a 404 on the list that stays after every try ends with exit 2, and makes no write", async () => {
    const { list } = protectCalls("acmelabs-15/nope");
    const world = fakeWorld({ spawn: ghScriptedEveryTry(list, ghAnswers.notFound) });
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "nope" },
      caller,
    );
    expect(outcome).toMatchObject({ ok: false, exitCode: 2, error: { kind: "input" } });
    expect(caller.updates).toEqual([
      protectStep("acmelabs-15/nope", "started"),
      protectStep("acmelabs-15/nope", "failed"),
    ]);
    expect(world.calls).toEqual(ghLoggedEveryTry(list));
  });

  test("a repo name that fails the name check ends with exit 2 before the step starts, and makes no call", async () => {
    const world = fakeWorld();
    const caller = frontEnd(world);
    const outcome = await runCommand(
      protectMainCommand,
      { owner: "acmelabs-15", name: "../user" },
      caller,
    );
    expect(outcome).toMatchObject({
      ok: false,
      exitCode: 2,
      error: { kind: "input", message: '"acmelabs-15/../user" is not a GitHub repo' },
    });
    expect(caller.updates).toEqual([]);
    expect(world.calls).toEqual([]);
  });
});
