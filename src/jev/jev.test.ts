/**
 * Tests for the `jev` HTTP client module.
 *
 * All tests inject a fake `fetch` so no network calls are made. The
 * mock stores every request and replays a programmable sequence of
 * HTTP responses (status + body + headers). Sleep and RNG are
 * virtualised so timing assertions are deterministic and fast.
 */

import { describe, expect, it, vi } from "vitest";

import { JevClient } from "./client.js";
import { type Question, type Request } from "./types.js";
import { computeBackoff, defaultPolicy } from "./retry.js";
import { retryAfter, type Clock } from "./http-status.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────

const validRequest: Request = {
  model: "jev-latest",
  state: { name: "example", body: "{ do_work(); }" },
  questions: {
    quality: {
      type: "choice",
      instructions: "Is this clear?",
      criteria: { clear: "Clear", unclear: "Unclear" },
    } satisfies Question,
  },
};

function makeAnswer(): {
  body: string;
  parsed: {
    model: string;
    answers: {
      quality: { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
    };
  };
} {
  return {
    body: JSON.stringify({
      model: "jev-test",
      answers: {
        quality: {
          type: "choice",
          choice: "clear",
          confidence: 0.8,
          probabilities: { clear: 0.9, unclear: 0.1 },
        },
      },
    }),
    parsed: {
      model: "jev-test",
      answers: {
        quality: {
          type: "choice",
          choice: "clear",
          confidence: 0.8,
          probabilities: { clear: 0.9, unclear: 0.1 },
        },
      },
    },
  };
}

// ─── Fake fetch ────────────────────────────────────────────────────────────

interface MockResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function createMockFetch(responses: MockResponse[]) {
  let callIndex = 0;
  const calls: CapturedRequest[] = [];
  const fetchImpl: NonNullable<ConstructorParameters<typeof JevClient>[0]["fetch"]> = async (
    url,
    init,
  ) => {
    calls.push({
      url,
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
    });
    const r = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    if (r === undefined) {
      throw new Error("mock fetch exhausted");
    }
    return {
      status: r.status,
      headers: {
        get(name: string): string | null {
          if (!r.headers) return null;
          const found = Object.entries(r.headers).find(
            ([k]) => k.toLowerCase() === name.toLowerCase(),
          );
          return found ? found[1] : null;
        },
      },
      text: async () => r.body,
    };
  };
  return { fetchImpl, calls };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeClient(fetchImpl: ReturnType<typeof createMockFetch>["fetchImpl"]) {
  return new JevClient({
    key: "test-key",
    endpoint: "https://jev.example.test/evaluate",
    fetch: fetchImpl,
    sleep: async () => {},
    rng: () => 0, // Disable jitter so timing assertions are deterministic
    userAgent: "1.2.3-test",
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("JevClient — construction", () => {
  it("constructs a client with a valid key", () => {
    const client = new JevClient({ key: "test-key" });
    expect(client.endpoint).toBe("https://api.typesafe.ai/v1/systemone");
    expect(client.userAgent.startsWith("ts-semantic-lint/")).toBe(true);
  });

  it("accepts a custom endpoint", () => {
    const client = new JevClient({ key: "test-key", endpoint: "https://custom.test/v1" });
    expect(client.endpoint).toBe("https://custom.test/v1");
  });

  it("throws on an empty key", () => {
    expect(() => new JevClient({ key: "" })).toThrow(/key must not be empty/);
  });

  it("throws on a whitespace-only key", () => {
    expect(() => new JevClient({ key: "   " })).toThrow(/key must not be empty/);
  });
});

describe("JevClient.evaluate — success path", () => {
  it("POSTs JSON to the endpoint with a Bearer header and User-Agent", async () => {
    const answer = makeAnswer();
    const { fetchImpl, calls } = createMockFetch([{ status: 200, body: answer.body }]);
    const client = makeClient(fetchImpl);
    const response = await client.evaluate(validRequest);
    expect(response.model).toBe("jev-test");
    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://jev.example.test/evaluate");
    expect(req.headers["Authorization"]).toBe("Bearer test-key");
    expect(req.headers["User-Agent"]).toBe("ts-semantic-lint/1.2.3-test");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual(validRequest);
  });

  it("returns the parsed response on a 2xx with valid JSON", async () => {
    const answer = makeAnswer();
    const { fetchImpl } = createMockFetch([{ status: 200, body: answer.body }]);
    const client = makeClient(fetchImpl);
    const response = await client.evaluate(validRequest);
    expect(response.model).toBe("jev-test");
    expect(response.answers["quality"]?.choice).toBe("clear");
  });
});

describe("JevClient.evaluate — retry on transient HTTP failures", () => {
  it.each([408, 429, 500, 502, 503, 504])(
    "retries on HTTP %i and succeeds on the second attempt",
    async (status) => {
      const answer = makeAnswer();
      const { fetchImpl, calls } = createMockFetch([
        { status, body: "" },
        { status: 200, body: answer.body },
      ]);
      const client = makeClient(fetchImpl);
      const response = await client.evaluate(validRequest);
      expect(response.model).toBe("jev-test");
      expect(calls).toHaveLength(2);
      // Same auth + body on the retry, mirroring the Rust test.
      expect(calls[0]?.headers["Authorization"]).toBe("Bearer test-key");
      expect(calls[1]?.headers["Authorization"]).toBe("Bearer test-key");
    },
  );

  it("fails (no retry) on HTTP 401", async () => {
    const { fetchImpl, calls } = createMockFetch([{ status: 401, body: "" }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(/HTTP 401/);
    expect(calls).toHaveLength(1);
  });

  it("fails (no retry) on HTTP 403", async () => {
    const { fetchImpl, calls } = createMockFetch([{ status: 403, body: "" }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(/HTTP 403/);
    expect(calls).toHaveLength(1);
  });

  it("fails (no retry) on HTTP 400", async () => {
    const { fetchImpl, calls } = createMockFetch([{ status: 400, body: "" }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(/HTTP 400/);
    expect(calls).toHaveLength(1);
  });

  it("fails (no retry) on HTTP 404", async () => {
    const { fetchImpl, calls } = createMockFetch([{ status: 404, body: "" }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
  });

  it("fails after exactly 4 attempts on a persistent 500", async () => {
    const { fetchImpl, calls } = createMockFetch([{ status: 500, body: "" }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow();
    expect(calls).toHaveLength(4);
  });
});

describe("JevClient.evaluate — Retry-After handling", () => {
  it("honors Retry-After: 2 (sleeps at least 2s)", async () => {
    const answer = makeAnswer();
    let totalSleepMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      totalSleepMs += ms;
    });
    const { fetchImpl, calls } = createMockFetch([
      { status: 429, body: "", headers: { "Retry-After": "2" } },
      { status: 200, body: answer.body },
    ]);
    const client = new JevClient({
      key: "test-key",
      endpoint: "https://jev.example.test/evaluate",
      fetch: fetchImpl,
      sleep,
      rng: () => 0,
      userAgent: "1.2.3-test",
    });
    const response = await client.evaluate(validRequest);
    expect(response.model).toBe("jev-test");
    expect(calls).toHaveLength(2);
    // Backoff (1s base, jitter disabled) vs Retry-After (2s) — max wins.
    expect(totalSleepMs).toBeGreaterThanOrEqual(2000);
  });

  it("honors Retry-After as an HTTP-date", async () => {
    const answer = makeAnswer();
    let totalSleepMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      totalSleepMs += ms;
    });
    const futureDate = new Date(Date.now() + 5_000).toUTCString();
    const { fetchImpl, calls } = createMockFetch([
      { status: 503, body: "", headers: { "Retry-After": futureDate } },
      { status: 200, body: answer.body },
    ]);
    const client = new JevClient({
      key: "test-key",
      endpoint: "https://jev.example.test/evaluate",
      fetch: fetchImpl,
      sleep,
      rng: () => 0,
      userAgent: "1.2.3-test",
    });
    const response = await client.evaluate(validRequest);
    expect(response.model).toBe("jev-test");
    expect(calls).toHaveLength(2);
    // Future-date → ~5s; backoff base is 1s. Retry-After wins.
    expect(totalSleepMs).toBeGreaterThanOrEqual(4_000);
    expect(totalSleepMs).toBeLessThanOrEqual(5_500);
  });

  it("fails when Retry-After exceeds 60s (no retry)", async () => {
    const { fetchImpl, calls } = createMockFetch([
      { status: 429, body: "", headers: { "Retry-After": "61" } },
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(/60s retry limit/);
    expect(calls).toHaveLength(1);
  });
});

describe("JevClient.evaluate — response validation", () => {
  it("fails when the response body is not valid JSON", async () => {
    const { fetchImpl, calls } = createMockFetch([
      { status: 200, body: "not json" },
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow();
    // Invalid JSON on a 200 is a permanent failure — only one attempt.
    expect(calls).toHaveLength(1);
  });

  it("fails when response.answers keys do not match request.questions keys", async () => {
    const body = JSON.stringify({
      model: "jev-test",
      answers: {
        unrelated: {
          type: "choice",
          choice: "a",
          confidence: 0.5,
          probabilities: { a: 0.5, b: 0.5 },
        },
      },
    });
    const { fetchImpl, calls } = createMockFetch([{ status: 200, body }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(
      /missing or unexpected question ids/,
    );
    expect(calls).toHaveLength(1);
  });

  it("fails when an answer's choice is not in the question's criteria", async () => {
    const body = JSON.stringify({
      model: "jev-test",
      answers: {
        quality: {
          type: "choice",
          choice: "undeclared",
          confidence: 0.5,
          probabilities: { clear: 0.5, unclear: 0.5 },
        },
      },
    });
    const { fetchImpl } = createMockFetch([{ status: 200, body }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(
      /unknown choice "undeclared"/,
    );
  });

  it("fails when an answer's probabilities keys do not match the question criteria", async () => {
    const body = JSON.stringify({
      model: "jev-test",
      answers: {
        quality: {
          type: "choice",
          choice: "clear",
          confidence: 0.9,
          probabilities: { clear: 1.0 },
        },
      },
    });
    const { fetchImpl } = createMockFetch([{ status: 200, body }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(
      /probabilities/,
    );
  });

  it("fails when the response model is empty", async () => {
    const body = JSON.stringify({
      model: "  ",
      answers: {
        quality: {
          type: "choice",
          choice: "clear",
          confidence: 0.9,
          probabilities: { clear: 0.9, unclear: 0.1 },
        },
      },
    });
    const { fetchImpl } = createMockFetch([{ status: 200, body }]);
    const client = makeClient(fetchImpl);
    await expect(client.evaluate(validRequest)).rejects.toThrow(/empty model/);
  });
});

describe("JevClient — transport failures are retried", () => {
  it("retries when the underlying fetch throws", async () => {
    const answer = makeAnswer();
    let calls = 0;
    const fetchImpl: NonNullable<ConstructorParameters<typeof JevClient>[0]["fetch"]> = async () => {
      calls++;
      if (calls === 1) {
        throw new Error("ECONNRESET");
      }
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => answer.body,
      };
    };
    const client = new JevClient({
      key: "test-key",
      endpoint: "https://jev.example.test/evaluate",
      fetch: fetchImpl,
      sleep: async () => {},
      rng: () => 0,
      userAgent: "1.2.3-test",
    });
    const response = await client.evaluate(validRequest);
    expect(response.model).toBe("jev-test");
    expect(calls).toBe(2);
  });

  it("fails after 4 attempts when the underlying fetch always throws", async () => {
    let calls = 0;
    const fetchImpl: NonNullable<ConstructorParameters<typeof JevClient>[0]["fetch"]> = async () => {
      calls++;
      throw new Error("ECONNRESET");
    };
    const client = new JevClient({
      key: "test-key",
      endpoint: "https://jev.example.test/evaluate",
      fetch: fetchImpl,
      sleep: async () => {},
      rng: () => 0,
      userAgent: "1.2.3-test",
    });
    await expect(client.evaluate(validRequest)).rejects.toThrow();
    expect(calls).toBe(4);
  });
});

describe("computeBackoff", () => {
  it("returns 1s, 2s, 4s (+/- jitter) for attempts 2/3/4", () => {
    expect(computeBackoff(2, defaultPolicy, () => 0)).toBe(1000);
    expect(computeBackoff(3, defaultPolicy, () => 0)).toBe(2000);
    expect(computeBackoff(4, defaultPolicy, () => 0)).toBe(4000);
  });

  it("applies up to 100% jitter (max at rng = 0.999...)", () => {
    // rng = 0 → scale = 1 → exact base
    // rng = (1 - epsilon) → scale ≈ 2 → close to 2× base
    const lower = computeBackoff(2, defaultPolicy, () => 0);
    const upper = computeBackoff(2, defaultPolicy, () => 0.999999);
    expect(lower).toBe(1000);
    expect(upper).toBeGreaterThanOrEqual(1999);
    expect(upper).toBeLessThanOrEqual(2000);
  });

  it("returns 0 for the initial attempt", () => {
    expect(computeBackoff(1, defaultPolicy)).toBe(0);
  });

  it("caps exponential growth at maxDelayMs", () => {
    const policy = { ...defaultPolicy, minDelayMs: 30_000, factor: 2, maxDelayMs: 60_000 };
    // Without cap: 30000, 60000, 120000 → cap kicks in at attempt 4
    expect(computeBackoff(2, policy, () => 0)).toBe(30_000);
    expect(computeBackoff(3, policy, () => 0)).toBe(60_000); // capped
    expect(computeBackoff(4, policy, () => 0)).toBe(60_000); // capped
  });
});

describe("retryAfter", () => {
  const fixedNow = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
  const clock: Clock = { now: () => fixedNow };

  it("parses numeric seconds", () => {
    expect(retryAfter("10", clock)).toBe(10_000);
  });

  it("parses HTTP-date", () => {
    expect(retryAfter("Wed, 21 Oct 2015 07:28:15 GMT", clock)).toBe(15_000);
  });

  it("clamps past HTTP-dates to 0", () => {
    expect(retryAfter("Wed, 21 Oct 2015 07:27:59 GMT", clock)).toBe(0);
  });

  it("returns undefined for empty / invalid values", () => {
    expect(retryAfter("", clock)).toBeUndefined();
    expect(retryAfter("invalid", clock)).toBeUndefined();
    expect(retryAfter("-1", clock)).toBeUndefined();
    expect(retryAfter("+1", clock)).toBeUndefined();
    expect(retryAfter(null, clock)).toBeUndefined();
    expect(retryAfter(undefined, clock)).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(retryAfter("  5  ", clock)).toBe(5000);
  });
});
