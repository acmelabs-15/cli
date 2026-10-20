import type { CommandError } from "./outcome";
import type { FetchInit } from "./world";
import {
  bodyLimitReached,
  byteCounter,
  longestTimerMs,
  requestLimits,
  requestTimeLimitReached,
} from "./world-limits";

/** fetch's own options: a fetch call's options without the World's limits. */
export function fetchOptions(init: FetchInit): RequestInit {
  const { timeoutMs: _timeoutMs, maxBodyBytes: _maxBodyBytes, ...options } = init;
  return options;
}

/** A request's method in capitals: the options' method, else a Request's own, else GET. */
function methodOf(input: string | URL | Request, options: RequestInit): string {
  return (options.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

/**
 * A request in words, for a message: its method and its URL in normal form, such as
 * `GET https://api.github.com/`. The whole URL, its query too: runCommand removes a secret from
 * every message, so the World does not.
 */
export function methodAndUrl(input: string | URL | Request, options: RequestInit = {}): string {
  const url = input instanceof Request ? input.url : new URL(input).href;
  return `${methodOf(input, options)} ${url}`;
}

/**
 * A response body whose first read rejects with `failure`. It reads nothing, and fails only when
 * it is read.
 */
export function failingBody(failure: CommandError): ReadableStream<Uint8Array> {
  return new ReadableStream(
    {
      pull(controller) {
        controller.error(failure);
      },
    },
    // No read ahead, so the body fails at the caller's read, as a body that is read fails.
    { highWaterMark: 0 },
  );
}

/**
 * The response with another body, and the same status, headers, URL and redirect flag. A new
 * Response has no URL of its own, so it gets the fetched one's. Its `type` is "default", and a
 * clone of it has no URL.
 */
function withBody(response: Response, body: ReadableStream<Uint8Array>): Response {
  const replaced = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return Object.defineProperties(replaced, {
    url: { value: response.url },
    redirected: { value: response.redirected },
  });
}

/**
 * The body limit of one request: the request in words, for the failure; the most bytes of its
 * body; and the call's failure behind any other error of a read, such as the time-out.
 */
type BodyLimit = {
  request: string;
  maxBytes: number;
  failureOf: (error: unknown) => unknown;
};

/**
 * A response body that counts its bytes as the caller reads it. Past the limit it cancels the
 * fetched body and rejects the read with the body limit's failure. Bun's fetch decompresses the
 * body, so the count is of the bytes the caller gets, not of the bytes on the wire. A cancel of
 * this body cancels the fetched one at once, a read in progress too.
 */
function countedBody(
  body: ReadableStream<Uint8Array>,
  limit: BodyLimit,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const pastLimit = byteCounter(limit.maxBytes);
  return new ReadableStream(
    {
      async pull(controller) {
        const next = await reader.read().catch((error: unknown) => {
          throw limit.failureOf(error);
        });
        if (next.done) {
          controller.close();
        } else if (pastLimit(next.value)) {
          await reader.cancel();
          throw bodyLimitReached(limit.request, limit.maxBytes);
        } else {
          controller.enqueue(next.value);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    // No read ahead: the fetched body is read only as far as the caller reads.
    { highWaterMark: 0 },
  );
}

/**
 * Whether HTTP gives an answer no body: the answer to HEAD, a 204 No Content or a 304 Not Modified.
 * Such an answer's Content-Length tells the size of another answer's body, such as a GET's.
 */
function hasNoBody(method: string, status: number): boolean {
  return method === "HEAD" || status === 204 || status === 304;
}

/**
 * The fetched response, with a body that holds to the body limit. A body whose Content-Length is
 * past the limit is never read: it is cancelled, and its first read rejects. Any other body is
 * counted as it is read. An answer that HTTP gives no body comes back as it is.
 */
async function limitedResponse(
  response: Response,
  method: string,
  limit: BodyLimit,
): Promise<Response> {
  const { body } = response;
  if (body === null || hasNoBody(method, response.status)) {
    return response;
  }
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > limit.maxBytes) {
    try {
      await body.cancel();
    } catch {
      // A body that failed already, such as at the time-out, rejects the cancel too. It is gone
      // either way, and its first read rejects with the body limit's failure all the same.
    }
    return withBody(response, failingBody(bodyLimitReached(limit.request, limit.maxBytes)));
  }
  return withBody(response, countedBody(body, limit));
}

/**
 * Sends a request with Bun's fetch, under its time limit and its body limit. The time limit is an
 * `AbortSignal.timeout` beside the call's own signal. Bun stops the body too when the signal on
 * the request aborts, so the limit covers the whole answer (note 10, section 3). The call's own
 * signal wins over the time limit: a cancel stays a cancel.
 */
export async function fetchWithLimits(
  input: string | URL | Request,
  init: FetchInit = {},
): Promise<Response> {
  const options = fetchOptions(init);
  // The call's own signal: the options' signal, else a Request's own, as fetch takes it.
  const own = options.signal ?? (input instanceof Request ? input.signal : undefined);
  // An aborted signal sends no request, and the call keeps the signal's reason.
  own?.throwIfAborted();
  const { timeoutMs, maxBodyBytes } = requestLimits(init);
  const request = methodAndUrl(input, options);
  // AbortSignal.timeout throws for a delay past the largest safe integer, such as Infinity.
  const timeout = AbortSignal.timeout(Math.min(timeoutMs, longestTimerMs));
  // The call's failure behind an error of the request or of its body: the cancel's reason, the
  // time limit's failure, or else the error as it is.
  function failureOf(error: unknown): unknown {
    if (own?.aborted === true) {
      return own.reason;
    }
    if (timeout.aborted) {
      return requestTimeLimitReached(request, timeoutMs);
    }
    return error;
  }
  let response: Response;
  try {
    response = await fetch(input, {
      ...options,
      signal: own === undefined ? timeout : AbortSignal.any([own, timeout]),
    });
  } catch (error) {
    throw failureOf(error);
  }
  return limitedResponse(response, methodOf(input, options), {
    request,
    maxBytes: maxBodyBytes,
    failureOf,
  });
}
