import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { fakeWorld } from "../fake-world";
import { CommandError } from "../outcome";
import { realWorld } from "../world";
import { limits } from "../world-limits";

/** A local HTTP server, with one route for each kind of answer the request tests need. */
let server: ReturnType<typeof Bun.serve>;

/**
 * A local TCP server that answers in raw HTTP, for the answers Bun.serve does not send: a body
 * that announces 1 GB and sends 10 bytes, a 304 with a Content-Length, and a body cut short.
 */
let raw: Bun.TCPSocketListener;

/** A local TCP server that closes each connection at once, before it reads the request. */
let closing: Bun.TCPSocketListener;

/** Resolved with the request when the server gets one at /hold; a test sets a new one first. */
let held = Promise.withResolvers<Request>();

/** Resolved when the server's /slow-body stream is cancelled; a test sets a new one first. */
let slowBodyCancelled = Promise.withResolvers<string>();

/** How many requests the server got at /count. */
let counted = 0;

/** The URL of a path on the local server. */
function at(route: string): string {
  return new URL(route, server.url).href;
}

/** The URL of a path on the raw server. */
function atRaw(route: string): string {
  return `http://localhost:${raw.port}${route}`;
}

/** Reads a stream to its end, and keeps nothing. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<void> {
  for await (const _chunk of stream) {
    // Each chunk is read and dropped.
  }
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      async "/late"() {
        await Bun.sleep(1000);
        return new Response("late answer");
      },
      async "/hold"(request) {
        held.resolve(request);
        await Bun.sleep(3000);
        return new Response("late answer");
      },
      // Headers at once, then one byte every 100 ms, and no end.
      "/slow-body": () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              await Bun.sleep(100);
              controller.enqueue(new TextEncoder().encode("x"));
            },
            cancel() {
              slowBodyCancelled.resolve("cancelled");
            },
          }),
        ),
      // A chunked body of 64 KB chunks, as fast as the reader takes them, and no end.
      "/endless": () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(64 * 1024).fill(120));
            },
          }),
        ),
      // 2 MB of x, compressed to about 2 KB: its Content-Length is the compressed size.
      "/gzip": () =>
        new Response(Bun.gzipSync(Buffer.alloc(2 * 1024 * 1024, "x")), {
          headers: { "Content-Encoding": "gzip" },
        }),
      "/moved": () => Response.redirect("/made", 302),
      "/loop": () => Response.redirect("/loop", 302),
      // Bun.serve sends the standard reason phrase, Created.
      "/made": () => new Response("made", { status: 201, headers: { "x-acmelabs": "made" } }),
      "/count"() {
        counted += 1;
        return new Response("counted");
      },
      // A body of that many bytes of x; Bun sends its Content-Length.
      "/bytes/:count": (request) => new Response(Buffer.alloc(Number(request.params.count), "x")),
    },
    fetch: () => new Response("no such route", { status: 404 }),
  });
  raw = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data(socket, data) {
        // The request's first line names its path, such as `GET /not-modified HTTP/1.1`.
        const request = data.toString();
        if (request.startsWith("GET /not-modified ")) {
          socket.write("HTTP/1.1 304 Not Modified\r\nContent-Length: 2097152\r\n\r\n");
        } else if (request.startsWith("GET /cut-short ")) {
          // 10 bytes of the 100 it announces, then the server closes, after fetch has the headers.
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n0123456789");
          setTimeout(() => socket.end(), 50);
        } else {
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 1073741824\r\n\r\n0123456789");
        }
      },
    },
  });
  closing = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.end();
      },
      data() {
        // The connection is closed already; nothing is read.
      },
    },
  });
});

afterAll(() => {
  // Not awaited: on Bun 1.4.0, after a time-out on one request and a cancel on another, the server
  // never sees those clients go, and its stop never resolves. Bun's own fetch does the same.
  server.stop(true);
  raw.stop(true);
  closing.stop(true);
});

describe("realWorld: a request's time limit", () => {
  test("a request gets 1 minute, to the end of its body, unless the call sets its own time limit", () => {
    expect(limits.requestMs).toBe(60_000);
  });

  test("a request whose answer does not come within its time limit fails, with an outside failure that names it and the limit", async () => {
    // The server answers after 1 second; the call fails before that, so the request stopped.
    const fetched = realWorld().fetch(at("/late"), { timeoutMs: 300 });
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/late")} got no whole answer within 300 milliseconds and was stopped`,
      issues: [],
    });
  });

  test("a request whose body does not end within its time limit fails at the read of the body, with the same failure", async () => {
    const started = performance.now();
    // The headers come at once, so fetch gives the response; the body never ends.
    const response = await realWorld().fetch(at("/slow-body"), { timeoutMs: 300 });
    expect(response.status).toBe(200);
    const read = response.text();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/slow-body")} got no whole answer within 300 milliseconds and was stopped`,
      issues: [],
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("with the time limit raised, the same request gets its answer", async () => {
    const response = await realWorld().fetch(at("/late"), { timeoutMs: 10_000 });
    expect(await response.text()).toBe("late answer");
  });

  test("a limit longer than a timer can hold still lets the request finish", async () => {
    // AbortSignal.timeout throws for Infinity; the World must not.
    const response = await realWorld().fetch(at("/bytes/5"), {
      timeoutMs: Number.POSITIVE_INFINITY,
    });
    expect(await response.text()).toBe("xxxxx");
  });

  test("a cancel while the request waits for its answer rejects with the cancel's reason, not a time-out", async () => {
    const controller = new AbortController();
    held = Promise.withResolvers();
    const started = performance.now();
    // No time limit of its own: 1 minute, so only the cancel can end the call in this test.
    const fetched = realWorld().fetch(at("/hold"), { signal: controller.signal });
    // The server has the request, so the cancel comes while the request waits.
    await held.promise;
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(fetched).rejects.toBe(reason);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a cancel while the body is read rejects the read with the cancel's reason, not a time-out", async () => {
    const controller = new AbortController();
    const response = await realWorld().fetch(at("/slow-body"), { signal: controller.signal });
    const read = response.text();
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(read).rejects.toBe(reason);
  });

  test("a cancel of the body by its reader ends the read in progress, and stops the fetched body", async () => {
    slowBodyCancelled = Promise.withResolvers();
    const response = await realWorld().fetch(at("/slow-body"));
    const reader = (response.body ?? new ReadableStream<Uint8Array>()).getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    // The next byte comes in 100 ms; the cancel comes while the read waits for it.
    const pending = reader.read();
    await reader.cancel(new Error("the command needs no more of the body"));
    expect(await pending).toEqual({ done: true, value: undefined });
    // The server's stream is cancelled once the fetched body is.
    expect(await slowBodyCancelled.promise).toBe("cancelled");
  });

  test("a cancel wins over the time limit when both come before the read of the body", async () => {
    const controller = new AbortController();
    const response = await realWorld().fetch(at("/slow-body"), {
      signal: controller.signal,
      timeoutMs: 200,
    });
    // The time-out comes first, and then the cancel; the body is read after both.
    await Bun.sleep(400);
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(response.text()).rejects.toBe(reason);
  });

  test("a Request keeps its own method in the failure, and its own signal", async () => {
    const fetched = realWorld().fetch(new Request(at("/late"), { method: "POST" }), {
      timeoutMs: 300,
    });
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `POST ${at("/late")} got no whole answer within 300 milliseconds and was stopped`,
    });
    const controller = new AbortController();
    held = Promise.withResolvers();
    const cancelled = realWorld().fetch(new Request(at("/hold"), { signal: controller.signal }));
    await held.promise;
    const reason = new Error("the user pressed Ctrl+C");
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
  });

  test("a request's limit that is not a positive number is a bug in the caller, and sends nothing", async () => {
    counted = 0;
    for (const timeoutMs of [Number.NaN, 0, -1]) {
      const fetched = realWorld().fetch(at("/count"), { timeoutMs });
      await expect(fetched).rejects.toThrow(
        `a request's time limit is a positive number of milliseconds, not ${timeoutMs}`,
      );
      await expect(fetched).rejects.not.toBeInstanceOf(CommandError);
    }
    for (const maxBodyBytes of [Number.NaN, 0, -1]) {
      const fetched = realWorld().fetch(at("/count"), { maxBodyBytes });
      await expect(fetched).rejects.toThrow(
        `a request's body limit is a positive number of bytes, not ${maxBodyBytes}`,
      );
      await expect(fetched).rejects.not.toBeInstanceOf(CommandError);
    }
    const fake = fakeWorld({ fetch: [{ url: at("/count") }, { url: at("/count") }] });
    await expect(fake.fetch(at("/count"), { timeoutMs: 0 })).rejects.toThrow(
      "a request's time limit is a positive number of milliseconds, not 0",
    );
    await expect(fake.fetch(at("/count"), { maxBodyBytes: 0 })).rejects.toThrow(
      "a request's body limit is a positive number of bytes, not 0",
    );
    expect(counted).toBe(0);
  });
});

describe("realWorld: a request's body limit", () => {
  /** 1 MB, 1024 × 1024 bytes: the limit most of these tests set. */
  const oneMB = 1024 * 1024;

  test("a response body gets 10 MB unless the call sets its own body limit", () => {
    expect(limits.outputBytes).toBe(10_485_760);
  });

  test("a body whose Content-Length is above the body limit fails at its first read, and is never read", async () => {
    // The raw server announces 1 GB and sends 10 bytes. A read of the body would wait for the
    // rest until the time limit, and fail with the time limit's message, not this one.
    const response = await realWorld().fetch(atRaw("/announced"), {
      timeoutMs: 1500,
      maxBodyBytes: oneMB,
    });
    expect(response.status).toBe(200);
    const read = response.text();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${atRaw("/announced")} got a body of more than 1 MB and was stopped`,
      issues: [],
    });
  });

  test("an endless body stops at the body limit, with an outside failure that names the request and the limit", async () => {
    const started = performance.now();
    const response = await realWorld().fetch(at("/endless"), { maxBodyBytes: oneMB });
    const read = response.text();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/endless")} got a body of more than 1 MB and was stopped`,
      issues: [],
    });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a read of an over-limit body by json(), by bytes() or by its stream rejects with the same failure", async () => {
    const message = `GET ${at("/endless")} got a body of more than 1 MB and was stopped`;
    const world = realWorld();
    const asJson = await world.fetch(at("/endless"), { maxBodyBytes: oneMB });
    await expect(asJson.json()).rejects.toMatchObject({ kind: "outside", message });
    const asBytes = await world.fetch(at("/endless"), { maxBodyBytes: oneMB });
    await expect(asBytes.bytes()).rejects.toMatchObject({ kind: "outside", message });
    const asStream = await world.fetch(at("/endless"), { maxBodyBytes: oneMB });
    await expect(readAll(asStream.body ?? new ReadableStream())).rejects.toMatchObject({
      kind: "outside",
      message,
    });
  });

  test("a compressed body is counted as it reads, after decompression, not by its Content-Length", async () => {
    // About 2 KB on the wire, 2 MB once Bun decompresses it.
    const response = await realWorld().fetch(at("/gzip"), { maxBodyBytes: oneMB });
    expect(Number(response.headers.get("content-length"))).toBeLessThan(oneMB);
    await expect(response.text()).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/gzip")} got a body of more than 1 MB and was stopped`,
    });
  });

  test("a body under the body limit, and a body of exactly the limit, reads whole", async () => {
    const world = realWorld();
    const small = await world.fetch(at("/bytes/5"), { maxBodyBytes: oneMB });
    expect(await small.text()).toBe("xxxxx");
    const exact = await world.fetch(at(`/bytes/${oneMB}`), { maxBodyBytes: oneMB });
    const text = await exact.text();
    expect(text.length).toBe(1_048_576);
    expect(text).toMatch(/^x+$/u);
  });

  test("a body past 10 MB fails when the call sets no body limit", async () => {
    const response = await realWorld().fetch(at(`/bytes/${10 * oneMB + 1}`));
    await expect(response.text()).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at(`/bytes/${10 * oneMB + 1}`)} got a body of more than 10 MB and was stopped`,
    });
  });

  test("with the body limit raised, the same body reads whole", async () => {
    const response = await realWorld().fetch(at(`/bytes/${10 * oneMB + 1}`), {
      maxBodyBytes: 11 * oneMB,
    });
    const body = await response.bytes();
    expect(body.byteLength).toBe(10_485_761);
  });

  test("an answer that HTTP gives no body, to HEAD or a 304, passes the body limit whatever its Content-Length", async () => {
    const world = realWorld();
    // A HEAD answer's Content-Length tells the size of the body a GET would get.
    const head = await world.fetch(at(`/bytes/${2 * oneMB}`), {
      method: "HEAD",
      maxBodyBytes: oneMB,
    });
    expect(head.headers.get("content-length")).toBe("2097152");
    expect(await head.text()).toBe("");
    const notModified = await world.fetch(atRaw("/not-modified"), { maxBodyBytes: oneMB });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("content-length")).toBe("2097152");
    expect(await notModified.text()).toBe("");
  });

  test("the response keeps its status, headers and URL, after a redirect too", async () => {
    const response = await realWorld().fetch(at("/moved"));
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-acmelabs")).toBe("made");
    expect(response.url).toBe(at("/made"));
    expect(response.redirected).toBe(true);
    expect(await response.text()).toBe("made");
  });
});

describe("realWorld: a request that fails in the network", () => {
  test("a refused connection rejects with an outside failure that names the request and what failed", async () => {
    // A port that had a server a moment ago, and has none now.
    const gone = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const url = `http://127.0.0.1:${gone.port}/`;
    gone.stop(true);
    const fetched = realWorld().fetch(url);
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${url} failed: the connection was refused (ConnectionRefused)`,
      issues: [],
    });
  });

  test("a server that closes the connection at once gives an outside failure", async () => {
    const url = `http://127.0.0.1:${closing.port}/`;
    const fetched = realWorld().fetch(url, { method: "POST", body: "{}" });
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    // macOS gives ECONNRESET. A write to a socket that is closed already may give another code on
    // another system, so the test checks the failure's shape, not the code.
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: expect.stringMatching(/^POST http:\/\/127\.0\.0\.1:\d+\/ failed: .+ \(\w+\)$/u),
      issues: [],
    });
  });

  test("a body that the server cuts short fails at the read of the body, with an outside failure", async () => {
    // The headers come whole, so fetch gives the response; the body ends before its Content-Length.
    const response = await realWorld().fetch(atRaw("/cut-short"));
    expect(response.status).toBe(200);
    const read = response.text();
    await expect(read).rejects.toBeInstanceOf(CommandError);
    await expect(read).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${atRaw("/cut-short")} failed: the connection closed before the whole answer came (ECONNRESET)`,
      issues: [],
    });
  });

  test("a TLS handshake that fails gives an outside failure", async () => {
    // HTTPS to a server that speaks plain HTTP. Bun's code for it may differ by system, so the
    // test checks the failure's shape, not the code.
    const url = at("/made").replace(/^http:/u, "https:");
    const fetched = realWorld().fetch(url);
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: expect.stringMatching(/^GET https:\/\/localhost:\d+\/made failed: .+ \(\w+\)$/u),
      issues: [],
    });
  });

  test("a redirect without end gives an outside failure", async () => {
    const fetched = realWorld().fetch(at("/loop"));
    await expect(fetched).rejects.toBeInstanceOf(CommandError);
    await expect(fetched).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/loop")} failed: the answer redirected too many times (TooManyRedirects)`,
      issues: [],
    });
  });

  test("a failure that a call's option or URL can cause, but that has a network failure's shape, is an outside failure too", async () => {
    // Bun gives each of these one code for both causes: a redirect that the call forbids, and an
    // address that no socket opens to, such as port 0 or a broadcast address.
    const world = realWorld();
    const forbidden = world.fetch(at("/moved"), { redirect: "error" });
    await expect(forbidden).rejects.toMatchObject({
      kind: "outside",
      message: `GET ${at("/moved")} failed: the answer redirected, and the request allows no redirect (UnexpectedRedirect)`,
    });
    const noSocket = world.fetch("http://127.0.0.1:0/");
    await expect(noSocket).rejects.toMatchObject({
      kind: "outside",
      message:
        "GET http://127.0.0.1:0/ failed: no connection could be opened to the address (FailedToOpenSocket)",
    });
  });

  test("a caller's bug stays as fetch gives it, not an outside failure, and sends nothing", async () => {
    counted = 0;
    const world = realWorld();
    // A Request whose body was read already: fetch's error has a code, but no URL as its path.
    const used = new Request(at("/count"), { method: "POST", body: "{}" });
    await used.text();
    // Each call starts only when the loop comes to it, so no rejection waits unhandled.
    const bugs = [
      () => world.fetch("ftp://localhost/"),
      () => world.fetch(at("/count"), { headers: { "a bad name": "x" } }),
      () => world.fetch(at("/count"), { method: "GET", body: "{}" }),
      () => world.fetch(used),
    ];
    for (const send of bugs) {
      const fetched = send();
      await expect(fetched).rejects.toBeInstanceOf(TypeError);
      await expect(fetched).rejects.not.toBeInstanceOf(CommandError);
    }
    expect(counted).toBe(0);
  });
});
