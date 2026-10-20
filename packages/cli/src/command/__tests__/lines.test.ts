import { describe, expect, test } from "bun:test";

import { progressLine, resultLine } from "../lines";

describe("progressLine", () => {
  test("a step update gives a progress line, as the spec's first example", () => {
    const line = progressLine("new", {
      kind: "step",
      step: "create-repo",
      title: "Create the GitHub repo",
      status: "started",
    });
    expect(line).toBe(
      '{"type":"progress","command":"new","step":"create-repo","title":"Create the GitHub repo","status":"started"}',
    );
  });

  test("a message gives a message line, as the spec's second example", () => {
    const line = progressLine("new", {
      kind: "message",
      level: "warning",
      text: "agy is not on PATH; its validator is skipped",
    });
    expect(line).toBe(
      '{"type":"message","command":"new","level":"warning","text":"agy is not on PATH; its validator is skipped"}',
    );
  });

  test("a step's detail comes last, and only when the update has one", () => {
    const skipped = progressLine("version check", {
      kind: "step",
      step: "validate-agy",
      title: "Run Antigravity CLI's validator",
      status: "skipped",
      detail: "agy is not on PATH",
    });
    expect(skipped).toBe(
      '{"type":"progress","command":"version check","step":"validate-agy","title":"Run Antigravity CLI\'s validator","status":"skipped","detail":"agy is not on PATH"}',
    );
    const done = progressLine("version check", {
      kind: "step",
      step: "validate-claude",
      title: "Run Claude Code's validator",
      status: "done",
    });
    expect(done).toBe(
      '{"type":"progress","command":"version check","step":"validate-claude","title":"Run Claude Code\'s validator","status":"done"}',
    );
  });

  test("the fields come in the spec's order, whatever the order of the update's own fields", () => {
    const step = progressLine("new", {
      detail: "acmelabs-15/demo",
      status: "done",
      title: "Create the GitHub repo",
      step: "create-repo",
      kind: "step",
    });
    expect(step).toBe(
      '{"type":"progress","command":"new","step":"create-repo","title":"Create the GitHub repo","status":"done","detail":"acmelabs-15/demo"}',
    );
    const message = progressLine("new", {
      text: "pushing to origin",
      level: "info",
      kind: "message",
    });
    expect(message).toBe(
      '{"type":"message","command":"new","level":"info","text":"pushing to origin"}',
    );
  });
});

describe("resultLine", () => {
  test("a failure gives a result line with its error, as the spec's third example", () => {
    const line = resultLine({
      ok: false,
      command: "version check",
      exitCode: 1,
      durationMs: 14,
      error: {
        kind: "problem",
        message: "2 manifests disagree with package.json",
        issues: [
          {
            field: ".claude-plugin/plugin.json",
            message: "version is 0.1.0, package.json says 0.2.0",
          },
        ],
      },
    });
    expect(line).toBe(
      '{"type":"result","command":"version check","ok":false,"exitCode":1,"durationMs":14,"error":{"kind":"problem","message":"2 manifests disagree with package.json","issues":[{"field":".claude-plugin/plugin.json","message":"version is 0.1.0, package.json says 0.2.0"}]}}',
    );
  });

  test("a success gives a result line with the command's result", () => {
    const line = resultLine({
      ok: true,
      command: "version check",
      exitCode: 0,
      durationMs: 9,
      result: { checked: 3, hosts: ["claude-code", "codex"] },
    });
    expect(line).toBe(
      '{"type":"result","command":"version check","ok":true,"exitCode":0,"durationMs":9,"result":{"checked":3,"hosts":["claude-code","codex"]}}',
    );
  });

  test("the fields come in the spec's order, and an issue holds only its field and message", () => {
    // A command may give problem() a list whose items carry more than an issue's two fields.
    const drifted = {
      message: "version is 0.1.0, package.json says 0.2.0",
      host: "codex",
      field: ".codex-plugin/plugin.json",
    };
    const failed = resultLine({
      error: {
        issues: [drifted],
        message: "1 manifest disagrees with package.json",
        kind: "problem",
      },
      durationMs: 14,
      exitCode: 1,
      command: "version check",
      ok: false,
    });
    expect(failed).toBe(
      '{"type":"result","command":"version check","ok":false,"exitCode":1,"durationMs":14,"error":{"kind":"problem","message":"1 manifest disagrees with package.json","issues":[{"field":".codex-plugin/plugin.json","message":"version is 0.1.0, package.json says 0.2.0"}]}}',
    );
    const passed = resultLine({
      result: "synced",
      durationMs: 9,
      exitCode: 0,
      command: "version sync",
      ok: true,
    });
    expect(passed).toBe(
      '{"type":"result","command":"version sync","ok":true,"exitCode":0,"durationMs":9,"result":"synced"}',
    );
  });
});

describe("each line is one line", () => {
  test("a newline, a tab or any control character inside a value comes out escaped", () => {
    // DEL, NEL, and the Unicode line and paragraph separators too: JSON.stringify leaves them
    // raw, and NEL and the separators are line breaks to many readers.
    const text =
      "git push failed:\n ! [rejected]\tmain\u001B[0m del\u007F nel\u0085 ls\u2028 ps\u2029";
    const line = progressLine("new", { kind: "message", level: "warning", text });
    expect(line).toBe(
      String.raw`{"type":"message","command":"new","level":"warning","text":"git push failed:\n ! [rejected]\tmain\u001b[0m del\u007f nel\u0085 ls\u2028 ps\u2029"}`,
    );
    // Escaped, not changed: a reader gets the text back.
    expect(JSON.parse(line).text).toBe(text);
  });

  test("a result line escapes them too, in the error and in the result", () => {
    const failed = resultLine({
      ok: false,
      command: "new",
      exitCode: 3,
      durationMs: 14,
      error: {
        kind: "outside",
        message: "gh repo create failed:\nHTTP 502",
        issues: [{ field: "--name", message: "taken\u2028by acmelabs-15" }],
      },
    });
    expect(failed).toBe(
      String.raw`{"type":"result","command":"new","ok":false,"exitCode":3,"durationMs":14,"error":{"kind":"outside","message":"gh repo create failed:\nHTTP 502","issues":[{"field":"--name","message":"taken\u2028by acmelabs-15"}]}}`,
    );
    const passed = resultLine({
      ok: true,
      command: "new",
      exitCode: 0,
      durationMs: 9,
      result: { log: "line one\u0085line two\n" },
    });
    expect(passed).toBe(
      String.raw`{"type":"result","command":"new","ok":true,"exitCode":0,"durationMs":9,"result":{"log":"line one\u0085line two\n"}}`,
    );
  });
});
