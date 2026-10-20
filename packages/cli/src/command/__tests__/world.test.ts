import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fakeWorld, realWorld } from "../world";

let work: string;

beforeAll(async () => {
  // The real path, because macOS reaches the temp folder through a symlink.
  work = await realpath(await mkdtemp(path.join(tmpdir(), "acmelabs-world-")));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("realWorld", () => {
  test("spawn runs bun --version: code 0 and Bun's version on stdout", async () => {
    const spawned = await realWorld().spawn(["bun", "--version"]);
    expect(spawned).toEqual({ code: 0, stdout: `${Bun.version}\n`, stderr: "" });
  });

  test("spawn collects a failing program's exit code and stderr", async () => {
    const spawned = await realWorld().spawn([
      "bun",
      "-e",
      "process.stdout.write('half'); console.error('it broke'); process.exit(3)",
    ]);
    expect(spawned).toEqual({ code: 3, stdout: "half", stderr: "it broke\n" });
  });

  test("spawn runs the program in the working folder given as cwd", async () => {
    const spawned = await realWorld().spawn(["bun", "-e", "process.stdout.write(process.cwd())"], {
      cwd: work,
    });
    expect(spawned).toEqual({ code: 0, stdout: work, stderr: "" });
  });

  test("spawn gives the program the stdin text", async () => {
    const spawned = await realWorld().spawn(
      ["bun", "-e", "process.stdout.write(await Bun.stdin.text())"],
      { stdin: "line one\nline two\n" },
    );
    expect(spawned).toEqual({ code: 0, stdout: "line one\nline two\n", stderr: "" });
  });

  test("root is the working folder, env the process environment, fetch the global fetch", () => {
    const world = realWorld();
    expect(world.root).toBe(process.cwd());
    expect(world.env).toBe(process.env);
    expect(world.fetch).toBe(globalThis.fetch);
  });

  test("now is the current time", () => {
    const before = Date.now();
    const now = realWorld().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

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
});
