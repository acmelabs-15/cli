import { describe, expect, expectTypeOf, test } from "bun:test";

import type { FetchInit, World } from "../world";
import { realWorld } from "../world";

describe("realWorld", () => {
  test("root is the working folder, and env the process environment", () => {
    const world = realWorld();
    expect(world.root).toBe(process.cwd());
    expect(world.env).toBe(process.env);
  });

  test("fetch is a plain function that takes a request and its limits", () => {
    // A type test: tsc checks it in `bun run typecheck`. Bun's own fetch type carries more, such
    // as `preconnect`, which the World does not copy.
    expectTypeOf<World["fetch"]>().toEqualTypeOf<
      (input: string | URL | Request, init?: FetchInit) => Promise<Response>
    >();
  });

  test("now is the current time", () => {
    const before = Date.now();
    const now = realWorld().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
