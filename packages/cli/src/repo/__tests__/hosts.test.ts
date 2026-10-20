import { describe, expect, expectTypeOf, test } from "bun:test";

import { type HostId, hostIds } from "../hosts";

describe("hostIds", () => {
  test("names the four hosts in host-table order", () => {
    expect(hostIds).toEqual(["claude-code", "codex", "gemini-cli", "antigravity-cli"]);
  });

  test("HostId is exactly the four host ids", () => {
    expectTypeOf<HostId>().toEqualTypeOf<
      "claude-code" | "codex" | "gemini-cli" | "antigravity-cli"
    >();
  });
});
