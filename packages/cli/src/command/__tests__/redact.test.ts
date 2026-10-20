import { describe, expect, test } from "bun:test";

import { redactorFor } from "../redact";

describe("redactorFor", () => {
  test("removes the value of each env variable whose name holds TOKEN, SECRET, KEY or PASSWORD", () => {
    const redact = redactorFor({
      GH_TOKEN: "ghp_0123456789abcdef",
      npm_token: "npm_abcdefgh1234",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG",
      apiKey: "key-0123456789",
      DB_Password: "correct horse battery",
    });
    expect(
      redact(
        "gh: ghp_0123456789abcdef, npm: npm_abcdefgh1234, aws: wJalrXUtnFEMI/K7MDENG, api: key-0123456789, db: correct horse battery",
      ),
    ).toBe("gh: [redacted], npm: [redacted], aws: [redacted], api: [redacted], db: [redacted]");
  });

  test("keeps a value shorter than 8 characters, and the value of any other variable", () => {
    // A short value such as `1` would blank unrelated text.
    const redact = redactorFor({
      CI_KEY: "1",
      SHORT_TOKEN: "abc1234",
      LONG_TOKEN: "abcd5678",
      UNSET_TOKEN: undefined,
      HOME: "/Users/peter",
    });
    expect(redact("1 file has changes in /Users/peter: abc1234, abcd5678")).toBe(
      "1 file has changes in /Users/peter: abc1234, [redacted]",
    );
  });

  test("removes a longer value first, so no part of it stays", () => {
    const redact = redactorFor({ GH_TOKEN: "abcdefgh", NPM_TOKEN: "abcdefgh1234" });
    expect(redact("npm: abcdefgh1234, gh: abcdefgh")).toBe("npm: [redacted], gh: [redacted]");
  });

  test("removes the credentials in a URL", () => {
    const redact = redactorFor({});
    expect(redact("clone https://user:pass@github.com/acmelabs-15/cli.git failed")).toBe(
      "clone https://[redacted]@github.com/acmelabs-15/cli.git failed",
    );
    expect(redact("push https://x-access-token:ghp_abc@github.com/acmelabs-15/cli")).toBe(
      "push https://[redacted]@github.com/acmelabs-15/cli",
    );
    // A URL with no credentials stays, and so does a mail address after it.
    expect(redact("see https://github.com/acmelabs-15/cli or mail peter@example.com")).toBe(
      "see https://github.com/acmelabs-15/cli or mail peter@example.com",
    );
  });

  test("removes the value of a URL query parameter whose name holds a secret word", () => {
    const redact = redactorFor({});
    expect(redact("fetch https://x.example/api?token=abc123def&page=2 failed")).toBe(
      "fetch https://x.example/api?token=[redacted]&page=2 failed",
    );
    expect(
      redact(
        "https://x.example/?api_key=k1&X-Amz-Signature=s1&client_secret=c1&password=p1&auth=a1&sort=asc",
      ),
    ).toBe(
      "https://x.example/?api_key=[redacted]&X-Amz-Signature=[redacted]&client_secret=[redacted]&password=[redacted]&auth=[redacted]&sort=asc",
    );
    // The value ends at a fragment, and at a quote around the URL.
    expect(redact('"https://x.example/?access_token=abc#top"')).toBe(
      '"https://x.example/?access_token=[redacted]#top"',
    );
  });

  test("removes the value after Bearer in an authorization text", () => {
    const redact = redactorFor({});
    expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc-_~+/= was rejected")).toBe(
      "Authorization: Bearer [redacted] was rejected",
    );
    expect(redact("authorization: bearer ghp_0123456789")).toBe("authorization: bearer [redacted]");
  });

  test("keeps the period of a sentence that ends with a secret", () => {
    const redact = redactorFor({});
    expect(redact("fetch failed: https://x?token=abc. Try again.")).toBe(
      "fetch failed: https://x?token=[redacted]. Try again.",
    );
    expect(redact("rejected Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc.")).toBe(
      "rejected Bearer [redacted].",
    );
  });

  test("keeps a text with no secret as it is", () => {
    const redact = redactorFor({ GH_TOKEN: "ghp_0123456789abcdef" });
    expect(redact("version is 0.1.0, package.json says 0.2.0")).toBe(
      "version is 0.1.0, package.json says 0.2.0",
    );
  });
});
