import { describe, expect, expectTypeOf, test } from "bun:test";

import { fakeWorld } from "../fake-world";
import { CommandError } from "../outcome";
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

describe("realWorld: a wait", () => {
  test("sleep waits about the time it is given", async () => {
    const started = performance.now();
    await realWorld().sleep(200);
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(150);
    expect(waited).toBeLessThan(2000);
  });

  test("a sleep of 0 milliseconds ends at once", async () => {
    const started = performance.now();
    await realWorld().sleep(0);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("sleep stops soon after its signal aborts, and rejects with the signal's reason", async () => {
    const controller = new AbortController();
    const started = performance.now();
    const slept = realWorld().sleep(10_000, { signal: controller.signal });
    await Bun.sleep(50);
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    // The reason itself, not the AbortError of node:timers/promises that holds it as its cause.
    await expect(slept).rejects.toBe(reason);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("sleep with a signal already aborted rejects with the reason, and does not wait", async () => {
    const reason = new Error("cancelled before the wait");
    const started = performance.now();
    await expect(realWorld().sleep(10_000, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a wait longer than a timer can hold does not end at once", async () => {
    // setTimeout fires at once for a delay past 2^31 - 1 ms; the World must not.
    const controller = new AbortController();
    const slept = realWorld().sleep(2 ** 31, { signal: controller.signal });
    const first = await Promise.race([
      slept.then(() => "the wait ended"),
      Bun.sleep(300).then(() => "still waiting"),
    ]);
    expect(first).toBe("still waiting");
    // The cancel ends the wait, so no timer of about 24 days keeps the test running.
    const reason = new Error("the test is done");
    controller.abort(reason);
    await expect(slept).rejects.toBe(reason);
  });

  test("a wait that is not a finite number of 0 or more is a bug in the caller", async () => {
    for (const ms of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const message = `a wait is a finite number of milliseconds, 0 or more, not ${ms}`;
      const slept = realWorld().sleep(ms);
      await expect(slept).rejects.toThrow(message);
      await expect(slept).rejects.not.toBeInstanceOf(CommandError);
      const fake = fakeWorld();
      await expect(fake.sleep(ms)).rejects.toThrow(message);
      // The fake's clock does not move for a wait that is a bug.
      expect(fake.now()).toEqual(fakeWorld().now());
    }
  });
});
