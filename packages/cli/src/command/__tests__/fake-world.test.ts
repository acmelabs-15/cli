import { describe, expect, test } from "bun:test";

import { fakeWorld } from "../fake-world";
import { CommandError } from "../outcome";

/** A folder for a call's root and cwd. fakeWorld never reads or writes it, so it need not exist. */
const work = "/acmelabs-test/work";

describe("fakeWorld", () => {
  test("root, env and now come from the options", () => {
    const world = fakeWorld({
      root: work,
      env: { GH_TOKEN: "token" },
      now: new Date("2026-10-20T12:00:00.000Z"),
    });
    expect(world.root).toBe(work);
    expect(world.env).toEqual({ GH_TOKEN: "token" });
    expect(world.now()).toEqual(new Date("2026-10-20T12:00:00.000Z"));
  });

  test("with no options: a root that does not exist, an empty env and a fixed time", () => {
    const world = fakeWorld();
    expect(world.root).toBe("/fake-world/repo");
    expect(world.env).toEqual({});
    expect(world.now()).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  test("an unscripted spawn call fails with an error that names the call", async () => {
    const world = fakeWorld();
    await expect(world.spawn(["gh", "auth", "status"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","auth","status"]; add one to its spawn list',
    );
  });

  test("spawn returns the scripted answer; an unset field is code 0 or no output", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "auth", "status"], answer: { code: 1, stderr: "not logged in\n" } },
        { commandLine: ["git", "status", "--short"] },
      ],
    });
    expect(await world.spawn(["git", "status", "--short"])).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
    expect(await world.spawn(["gh", "auth", "status"])).toEqual({
      code: 1,
      stdout: "",
      stderr: "not logged in\n",
    });
  });

  test("spawn matches a scripted command line word for word", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["gh", "auth", "status"] }] });
    await expect(world.spawn(["gh", "auth"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","auth"]',
    );
    await expect(world.spawn(["gh", "auth", "status", "--active"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","auth","status","--active"]',
    );
    expect(await world.spawn(["gh", "auth", "status"])).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  test("a scripted missing program rejects as realWorld's spawn does, and is logged", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ["claude", "plugin", "validate", "."], missing: true }],
    });
    const spawned = world.spawn(["claude", "plugin", "validate", "."]);
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "claude is not installed or not on PATH",
      issues: [],
    });
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["claude", "plugin", "validate", "."] },
    ]);
  });

  test("a scripted time limit rejects with the same outside failure as realWorld's, and is logged", async () => {
    const commandLine = ["bun", "-e", "await Bun.sleep(2000); process.stdout.write('awake')"];
    const world = fakeWorld({ spawn: [{ commandLine, limit: "time" }] });
    const spawned = world.spawn(commandLine, { timeoutMs: 200 });
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "bun -e ... ran longer than 200 milliseconds and was stopped",
      issues: [],
    });
    expect(world.calls).toEqual([{ kind: "spawn", commandLine, timeoutMs: 200 }]);
  });

  test("a scripted time limit names the call's limit in words, or 5 minutes when it sets none", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user"], limit: "time" },
        { commandLine: ["bun", "install"], limit: "time" },
        { commandLine: ["git", "push"], limit: "time" },
        { commandLine: ["gh"], limit: "time" },
        { commandLine: ["git", "ls-remote"], limit: "time" },
      ],
    });
    await expect(world.spawn(["gh", "api", "user"])).rejects.toThrow(
      "gh api ... ran longer than 5 minutes and was stopped",
    );
    await expect(world.spawn(["bun", "install"], { timeoutMs: 60_000 })).rejects.toThrow(
      "bun install ran longer than 1 minute and was stopped",
    );
    await expect(world.spawn(["git", "push"], { timeoutMs: 90_000 })).rejects.toThrow(
      "git push ran longer than 90 seconds and was stopped",
    );
    await expect(world.spawn(["gh"], { timeoutMs: 1000 })).rejects.toThrow(
      "gh ran longer than 1 second and was stopped",
    );
    await expect(world.spawn(["git", "ls-remote"], { timeoutMs: 1500 })).rejects.toThrow(
      "git ls-remote ran longer than 1500 milliseconds and was stopped",
    );
  });

  test("a scripted output limit rejects with the same outside failure as realWorld's, and is logged", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["yes"], limit: "output" }] });
    const spawned = world.spawn(["yes"], { maxOutputBytes: 1024 * 1024 });
    await expect(spawned).rejects.toBeInstanceOf(CommandError);
    await expect(spawned).rejects.toMatchObject({
      kind: "outside",
      message: "yes printed more than 1 MB on stdout and was stopped",
      issues: [],
    });
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["yes"], maxOutputBytes: 1_048_576 },
    ]);
  });

  test("a scripted output limit names the call's limit in words, or 10 MB when it sets none", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user"], limit: "output" },
        { commandLine: ["git", "log"], limit: "output" },
        { commandLine: ["bun", "install"], limit: "output" },
        { commandLine: ["git", "ls-remote"], limit: "output" },
        { commandLine: ["gh"], limit: "output" },
      ],
    });
    await expect(world.spawn(["gh", "api", "user"])).rejects.toThrow(
      "gh api ... printed more than 10 MB on stdout and was stopped",
    );
    await expect(world.spawn(["git", "log"], { maxOutputBytes: 64 * 1024 })).rejects.toThrow(
      "git log printed more than 64 KB on stdout and was stopped",
    );
    await expect(world.spawn(["bun", "install"], { maxOutputBytes: 1_572_864 })).rejects.toThrow(
      "bun install printed more than 1536 KB on stdout and was stopped",
    );
    await expect(world.spawn(["git", "ls-remote"], { maxOutputBytes: 1500 })).rejects.toThrow(
      "git ls-remote printed more than 1500 bytes on stdout and was stopped",
    );
    await expect(world.spawn(["gh"], { maxOutputBytes: 1 })).rejects.toThrow(
      "gh printed more than 1 byte on stdout and was stopped",
    );
  });

  test("the log keeps a spawn call's env and limits, and leaves out its signal", async () => {
    const world = fakeWorld({ spawn: [{ commandLine: ["git", "push"] }] });
    await world.spawn(["git", "push"], {
      cwd: work,
      env: { GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 60_000,
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(world.calls).toEqual([
      {
        kind: "spawn",
        commandLine: ["git", "push"],
        cwd: work,
        env: { GIT_TERMINAL_PROMPT: "0" },
        timeoutMs: 60_000,
        maxOutputBytes: 1024,
      },
    ]);
  });

  test("an unscripted fetch call fails with an error that names the method and URL", async () => {
    const world = fakeWorld();
    await expect(
      world.fetch("https://registry.npmjs.org/@acmelabs/cli", { method: "PUT" }),
    ).rejects.toThrow(
      "fakeWorld has no scripted answer for fetch PUT https://registry.npmjs.org/@acmelabs/cli; add one to its fetch list",
    );
  });

  test("fetch returns the scripted response; an unset field is status 200 or no body", async () => {
    const world = fakeWorld({
      fetch: [
        {
          url: "https://registry.npmjs.org/@acmelabs/cli",
          answer: {
            status: 404,
            body: '{"error":"Not found"}',
            headers: { "content-type": "application/json" },
          },
        },
        { method: "PUT", url: "https://registry.npmjs.org/@acmelabs/cli" },
      ],
    });
    const missing = await world.fetch("https://registry.npmjs.org/@acmelabs/cli");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("application/json");
    expect(await missing.json()).toEqual({ error: "Not found" });
    const published = await world.fetch(new URL("https://registry.npmjs.org/@acmelabs/cli"), {
      method: "PUT",
    });
    expect(published.status).toBe(200);
    expect(await published.text()).toBe("");
  });

  test("fetch matches the method, GET by default, and the URL in normal form", async () => {
    const world = fakeWorld({
      fetch: [{ url: "https://api.github.com" }, { method: "put", url: "https://api.github.com" }],
    });
    await expect(world.fetch("https://api.github.com/", { method: "POST" })).rejects.toThrow(
      "fakeWorld has no scripted answer for fetch POST https://api.github.com/",
    );
    const read = await world.fetch("https://api.github.com/");
    expect(read.status).toBe(200);
    const written = await world.fetch("https://api.github.com/", { method: "PUT" });
    expect(written.status).toBe(200);
  });

  test("logs every spawn and fetch call in order, the unscripted ones too", async () => {
    const ruleset = '{"name":"Protect main"}';
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "auth", "status"] },
        { commandLine: ["gh", "api", "repos/acmelabs-15/cli/rulesets", "--input", "-"] },
      ],
      fetch: [{ url: "https://registry.npmjs.org/@acmelabs/cli" }],
    });
    await world.spawn(["gh", "auth", "status"], { cwd: work });
    await world.fetch("https://registry.npmjs.org/@acmelabs/cli");
    await world.spawn(["gh", "api", "repos/acmelabs-15/cli/rulesets", "--input", "-"], {
      stdin: ruleset,
    });
    await expect(world.spawn(["git", "push"])).rejects.toThrow("no scripted answer");
    await expect(world.fetch("https://example.com/", { method: "DELETE" })).rejects.toThrow(
      "no scripted answer",
    );
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["gh", "auth", "status"], cwd: work },
      { kind: "fetch", method: "GET", url: "https://registry.npmjs.org/@acmelabs/cli" },
      {
        kind: "spawn",
        commandLine: ["gh", "api", "repos/acmelabs-15/cli/rulesets", "--input", "-"],
        stdin: ruleset,
      },
      { kind: "spawn", commandLine: ["git", "push"] },
      { kind: "fetch", method: "DELETE", url: "https://example.com/" },
    ]);
  });

  test("a spawn or fetch whose signal is aborted rejects with the reason, and is logged", async () => {
    const world = fakeWorld({
      spawn: [{ commandLine: ["git", "push"] }],
      fetch: [{ url: "https://api.github.com/" }],
    });
    const reason = new Error("the user pressed Ctrl+C");
    const signal = AbortSignal.abort(reason);
    await expect(world.spawn(["git", "push"], { cwd: work, signal })).rejects.toBe(reason);
    await expect(world.fetch("https://api.github.com/", { signal })).rejects.toBe(reason);
    await expect(world.fetch(new Request("https://api.github.com/", { signal }))).rejects.toBe(
      reason,
    );
    // A cancelled call uses up no scripted answer, so a call that is not cancelled still gets it.
    expect(await world.spawn(["git", "push"])).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["git", "push"], cwd: work },
      { kind: "fetch", method: "GET", url: "https://api.github.com/" },
      { kind: "fetch", method: "GET", url: "https://api.github.com/" },
      { kind: "spawn", commandLine: ["git", "push"] },
    ]);
  });

  test("each scripted spawn answers one call, in list order, so a retry can succeed", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "user"], answer: { code: 1, stderr: "HTTP 502\n" } },
        { commandLine: ["gh", "api", "user"], answer: { stdout: '{"login":"octocat"}' } },
      ],
    });
    expect(await world.spawn(["gh", "api", "user"])).toEqual({
      code: 1,
      stdout: "",
      stderr: "HTTP 502\n",
    });
    expect(await world.spawn(["gh", "api", "user"])).toEqual({
      code: 0,
      stdout: '{"login":"octocat"}',
      stderr: "",
    });
    await expect(world.spawn(["gh", "api", "user"])).rejects.toThrow(
      'fakeWorld has no scripted answer for spawn ["gh","api","user"]',
    );
  });

  test("each scripted fetch answers one call, in list order, so a retry can succeed", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({
      fetch: [
        { url, answer: { status: 503 } },
        { url, answer: { status: 200 } },
      ],
    });
    const first = await world.fetch(url);
    expect(first.status).toBe(503);
    const retry = await world.fetch(url);
    expect(retry.status).toBe(200);
    await expect(world.fetch(url)).rejects.toThrow(
      `fakeWorld has no scripted answer for fetch GET ${url}`,
    );
  });

  test("a scripted request time limit rejects the fetch with the same outside failure as realWorld's, and is logged", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({ fetch: [{ url, limit: "time" }] });
    const fetched = world.fetch(url, { timeoutMs: 300 });
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${url} got no whole answer within 300 milliseconds and was stopped`,
      issues: [],
    });
    expect(world.calls).toEqual([{ kind: "fetch", method: "GET", url }]);
  });

  test("a scripted request time limit names the method, the URL in normal form, and the call's limit, or 1 minute when it sets none", async () => {
    const world = fakeWorld({
      fetch: [
        { url: "https://api.github.com", limit: "time" },
        { method: "PUT", url: "https://registry.npmjs.org/@acmelabs%2fcli", limit: "time" },
      ],
    });
    await expect(world.fetch("https://api.github.com")).rejects.toThrow(
      "GET https://api.github.com/ got no whole answer within 1 minute and was stopped",
    );
    const request = new Request("https://registry.npmjs.org/@acmelabs%2fcli", { method: "PUT" });
    await expect(world.fetch(request, { timeoutMs: 90_000 })).rejects.toThrow(
      "PUT https://registry.npmjs.org/@acmelabs%2fcli got no whole answer within 90 seconds and was stopped",
    );
  });

  test("a scripted body limit gives the response, and a read of its body rejects with the same outside failure as realWorld's", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({
      fetch: [
        {
          url,
          answer: { status: 200, headers: { "content-type": "application/json" } },
          limit: "output",
        },
      ],
    });
    const response = await world.fetch(url, { maxBodyBytes: 1024 * 1024 });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const read = response.json();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${url} got a body of more than 1 MB and was stopped`,
      issues: [],
    });
    expect(world.calls).toEqual([{ kind: "fetch", method: "GET", url }]);
  });

  test("sleep moves the clock by its time at once, and is logged", async () => {
    const world = fakeWorld({ now: new Date("2026-10-20T12:00:00.000Z") });
    const started = performance.now();
    await world.sleep(30 * 60 * 1000);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(world.now()).toEqual(new Date("2026-10-20T12:30:00.000Z"));
    expect(world.calls).toEqual([{ kind: "sleep", ms: 1_800_000 }]);
  });

  test("each sleep moves the clock on from the last, and the log keeps it among the other calls, in order", async () => {
    const world = fakeWorld({
      spawn: [
        { commandLine: ["gh", "api", "repos/acmelabs-15/cli/actions/runs"] },
        { commandLine: ["gh", "api", "repos/acmelabs-15/cli/actions/runs"] },
      ],
    });
    const times: string[] = [];
    await world.spawn(["gh", "api", "repos/acmelabs-15/cli/actions/runs"]);
    await world.sleep(10_000);
    times.push(world.now().toISOString());
    await world.spawn(["gh", "api", "repos/acmelabs-15/cli/actions/runs"]);
    await world.sleep(10_000);
    times.push(world.now().toISOString());
    await world.sleep(0);
    times.push(world.now().toISOString());
    expect(times).toEqual([
      "2026-01-01T00:00:10.000Z",
      "2026-01-01T00:00:20.000Z",
      "2026-01-01T00:00:20.000Z",
    ]);
    expect(world.calls).toEqual([
      { kind: "spawn", commandLine: ["gh", "api", "repos/acmelabs-15/cli/actions/runs"] },
      { kind: "sleep", ms: 10_000 },
      { kind: "spawn", commandLine: ["gh", "api", "repos/acmelabs-15/cli/actions/runs"] },
      { kind: "sleep", ms: 10_000 },
      { kind: "sleep", ms: 0 },
    ]);
  });

  test("a sleep whose signal is aborted rejects with the reason, is logged, and does not move the clock", async () => {
    const world = fakeWorld();
    const reason = new Error("the user pressed Ctrl+C");
    await expect(world.sleep(10_000, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(world.now()).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(world.calls).toEqual([{ kind: "sleep", ms: 10_000 }]);
  });

  test("a sleep past about 24 days moves the clock as long as the real wait lasts", async () => {
    // The real wait holds to the longest a timer holds, 2^31 - 1 ms; the fake clock must match.
    const world = fakeWorld();
    await world.sleep(30 * 24 * 60 * 60 * 1000);
    expect(world.now()).toEqual(new Date("2026-01-25T20:31:23.647Z"));
    expect(world.calls).toEqual([{ kind: "sleep", ms: 2_592_000_000 }]);
  });

  test("a Date that now returns is a copy: changing it does not move the clock", async () => {
    const world = fakeWorld();
    world.now().setUTCFullYear(2030);
    await world.sleep(1000);
    expect(world.now()).toEqual(new Date("2026-01-01T00:00:01.000Z"));
  });

  test("a scripted body limit names the call's limit in words, or 10 MB when it sets none", async () => {
    const url = "https://registry.npmjs.org/@acmelabs/cli";
    const world = fakeWorld({
      fetch: [
        { url, limit: "output" },
        { url, limit: "output" },
      ],
    });
    const unset = await world.fetch(url);
    await expect(unset.text()).rejects.toThrow(
      `GET ${url} got a body of more than 10 MB and was stopped`,
    );
    const set = await world.fetch(url, { maxBodyBytes: 64 * 1024 });
    await expect(set.text()).rejects.toThrow(
      `GET ${url} got a body of more than 64 KB and was stopped`,
    );
  });
});
