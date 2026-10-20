import { describe, expect, test } from "bun:test";

import { flagOf } from "../input";

describe("flagOf", () => {
  test("gives the field in kebab case after two dashes, with an acronym kept as one word", () => {
    expect(flagOf("host")).toBe("--host");
    expect(flagOf("dryRun")).toBe("--dry-run");
    expect(flagOf("npmURL")).toBe("--npm-url");
    expect(flagOf("URLPath")).toBe("--url-path");
    expect(flagOf("githubAPIToken")).toBe("--github-api-token");
    expect(flagOf("schemaV2")).toBe("--schema-v2");
  });
});
