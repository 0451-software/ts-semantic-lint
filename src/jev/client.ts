/**
 * TypeSafe Jev HTTP client.
 *
 * Mirrors `JevClient` in `src/jev.rs`. Sends `evaluate()` requests to the
 * TypeSafe API over `undici.fetch`, retries transient failures with
 * exponential backoff and full jitter, and validates the response shape
 * before returning it.
 *
 * The retry loop only wraps the network round-trip — a 200 OK with bad
 * JSON or an inconsistent answer shape fails immediately, just like the
 * Rust original.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { fetch as undiciFetch, Agent as UndiciAgent } from "undici";

import { retryAfter } from "./http-status.js";
import {
  type RandomSource,
  type RetryPolicy,
  type Sleeper,
  defaultPolicy,
  computeBackoff,
  applyDelay,
  mathRandom,
  realSleep,
} from "./retry.js";
import {
  type ChoiceAnswer,
  type Probability,
  type Request,
  type Response,
  ResponseValidationError,
  validateResponse,
  makeProbability,
} from "./types.js";

/** Default endpoint; mirrors `ENDPOINT` in `src/jev.rs`. */
export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** Maximum per-request timeout (matches Rust's 60-second timeout). */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Maximum connect-only timeout (matches Rust's 10-second connect timeout). */
export const CONNECT_TIMEOUT_MS = 10_000;

// ─── Errors ────────────────────────────────────────────────────────────────

export class JevError extends Error {
  override readonly name: string = "JevError";
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class JevConfigError extends JevError {
  override readonly name: string = "JevConfigError";
}

export class JevHttpError extends JevError {
  override readonly name: string = "JevHttpError";
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(
    message: string,
    status: number,
    retryAfterMs: number | undefined,
    cause?: unknown,
  ) {
    super(message, cause);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class JevRetryAfterExceededError extends JevHttpError {
  override readonly name: string = "JevRetryAfterExceededError";
  constructor(status: number, retryAfterMs: number) {
    super(
      `Jev returned HTTP ${status}; Retry-After of ${retryAfterMs}ms exceeds the 60s retry limit`,
      status,
      retryAfterMs,
    );
  }
}

export class JevResponseError extends JevError {
  override readonly name: string = "JevResponseError";
}

// ─── Fetch injection ───────────────────────────────────────────────────────

/** Shape of the injected `fetch` so tests can pass any compatible mock. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: "manual" | "follow" | "error";
    dispatcher?: unknown;
  },
) => Promise<{
  status: number;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}>;

// ─── Client options ────────────────────────────────────────────────────────

export interface JevClientOptions {
  /** API key. Required, non-empty. */
  readonly key: string;
  /** Override the API endpoint. Defaults to the production TypeSafe URL. */
  readonly endpoint?: string;
  /** Override the User-Agent suffix. Defaults to the package version. */
  readonly userAgent?: string;
  /** Custom fetch implementation (defaults to `undici.fetch`). */
  readonly fetch?: FetchLike;
  /** Custom sleeper (defaults to `setTimeout`-backed). */
  readonly sleep?: Sleeper;
  /** Custom random source for jitter (defaults to `Math.random`). */
  readonly rng?: RandomSource;
  /** Override the retry policy. */
  readonly policy?: RetryPolicy;
}

// ─── User-Agent resolution ─────────────────────────────────────────────────

let cachedVersion: string | undefined;

/**
 * Resolve the `ts-semantic-lint` package version by reading
 * `package.json` from the repo root. Falls back to `"0.0.0"` if the
 * file is unreadable (e.g. running from a compiled bundle where the
 * relative path differs — the fallback is a deliberate defensive
 * default, not a silent failure mode for the JSON body).
 */
export function resolvePackageVersion(fromUrl: string): string {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", fromUrl));
    const contents = readFileSync(pkgPath, "utf8");
    const parsed: unknown = JSON.parse(contents);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof (parsed as { version: unknown }).version === "string"
    ) {
      return (parsed as { version: string }).version;
    }
  } catch {
    // Fall through to fallback below.
  }
  return "0.0.0";
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** HTTP statuses that get a retry (matches the Rust predicate). */
const RETRY_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const PERMANENT_FAILURE_LIMIT_MS = 60_000;

function coerceProbability(value: unknown, path: string): Probability {
  if (typeof value !== "number") {
    throw new JevResponseError(
      `expected number at ${path}, got ${typeof value}`,
    );
  }
  try {
    return makeProbability(value);
  } catch (error) {
    throw new JevResponseError(
      `probability at ${path} is out of range: ${value}`,
      error,
    );
  }
}

function coerceAnswer(value: unknown, id: string): ChoiceAnswer {
  if (typeof value !== "object" || value === null) {
    throw new JevResponseError(`answers["${id}"] must be an object`);
  }
  const obj = value as Record<string, unknown>;
  if (obj["type"] !== "choice") {
    throw new JevResponseError(
      `answers["${id}"].type must be "choice", got ${String(obj["type"])}`,
    );
  }
  if (typeof obj["choice"] !== "string") {
    throw new JevResponseError(
      `answers["${id}"].choice must be a string`,
    );
  }
  const confidence = coerceProbability(obj["confidence"], `answers["${id}"].confidence`);
  const rawProbs = obj["probabilities"];
  if (typeof rawProbs !== "object" || rawProbs === null || Array.isArray(rawProbs)) {
    throw new JevResponseError(
      `answers["${id}"].probabilities must be an object`,
    );
  }
  const probabilities: Record<string, Probability> = {};
  for (const [key, raw] of Object.entries(rawProbs as Record<string, unknown>)) {
    probabilities[key] = coerceProbability(raw, `answers["${id}"].probabilities["${key}"]`);
  }
  return {
    type: "choice",
    choice: obj["choice"],
    confidence,
    probabilities,
  };
}

function coerceResponse(parsed: unknown): Response {
  if (typeof parsed !== "object" || parsed === null) {
    throw new JevResponseError("Jev response must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["model"] !== "string") {
    throw new JevResponseError("response.model must be a string");
  }
  const rawAnswers = obj["answers"];
  if (typeof rawAnswers !== "object" || rawAnswers === null || Array.isArray(rawAnswers)) {
    throw new JevResponseError("response.answers must be an object");
  }
  const answers: Record<string, ChoiceAnswer> = {};
  for (const [id, raw] of Object.entries(rawAnswers as Record<string, unknown>)) {
    answers[id] = coerceAnswer(raw, id);
  }
  return { model: obj["model"], answers };
}

// ─── Client ────────────────────────────────────────────────────────────────

export class JevClient {
  readonly #endpoint: string;
  readonly #authHeader: string;
  readonly #userAgent: string;
  readonly #fetch: FetchLike;
  readonly #sleep: Sleeper;
  readonly #rng: RandomSource;
  readonly #policy: RetryPolicy;

  constructor(options: JevClientOptions) {
    if (typeof options.key !== "string" || options.key.trim().length === 0) {
      throw new JevConfigError("jev_key must not be empty");
    }
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#authHeader = `Bearer ${options.key}`;
    this.#userAgent = `ts-semantic-lint/${options.userAgent ?? cachedVersion ?? (cachedVersion = resolvePackageVersion(import.meta.url))}`;
    this.#fetch = options.fetch ?? (undiciFetch as unknown as FetchLike);
    this.#sleep = options.sleep ?? realSleep;
    this.#rng = options.rng ?? mathRandom;
    this.#policy = options.policy ?? defaultPolicy;
  }

  /** The endpoint the client posts to. */
  get endpoint(): string {
    return this.#endpoint;
  }

  /** The User-Agent header sent on every request. */
  get userAgent(): string {
    return this.#userAgent;
  }

  /**
   * Send a Jev evaluation request and return the validated response.
   *
   * Retries transient HTTP failures (408/429/500/502/503/504) and
   * connection errors with exponential backoff, up to 4 total attempts.
   * Honors the `Retry-After` header as a minimum wait. Permanent HTTP
   * failures and shape mismatches fail immediately.
   */
  async evaluate(request: Request): Promise<Response> {
    let attempts = 0;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#policy.maxAttempts; attempt++) {
      attempts = attempt;
      try {
        const body = await this.#fetchOnce(request);
        const parsed: unknown = JSON.parse(body);
        const response = coerceResponse(parsed);
        validateResponse(response, request);
        return response;
      } catch (error) {
        lastError = error;
        const retryDelay = this.#classifyError(error);
        if (retryDelay === "fatal") {
          throw this.#wrapError(error, attempts);
        }
        if (attempt >= this.#policy.maxAttempts) {
          throw this.#wrapError(error, attempts);
        }
        await applyDelay(
          computeBackoff(attempt + 1, this.#policy, this.#rng),
          retryDelay,
          this.#policy,
          this.#sleep,
        );
        this.#notify(error, attempt);
      }
    }
    // Unreachable — the loop either returns or throws. Surface a wrapped
    // error here so the function satisfies `Promise<Response>` even if
    // the policy is somehow configured to 0 attempts.
    throw this.#wrapError(lastError, attempts);
  }

  async #fetchOnce(request: Request): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      // The dispatcher is only used by the undici fetch implementation
      // — it carries the per-origin connect timeout. The mock fetch in
      // tests ignores unknown init keys, so it can be left in place.
      const dispatcher = new UndiciAgent({ connectTimeout: CONNECT_TIMEOUT_MS });
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          Authorization: this.#authHeader,
          "Content-Type": "application/json",
          "User-Agent": this.#userAgent,
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
        redirect: "manual",
        dispatcher,
      });
      if (!response.status.toString().startsWith("2")) {
        const status = response.status;
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterMs = retryAfter(retryAfterHeader);
        if (retryAfterMs !== undefined && retryAfterMs > PERMANENT_FAILURE_LIMIT_MS) {
          throw new JevRetryAfterExceededError(status, retryAfterMs);
        }
        if (!RETRY_STATUSES.has(status)) {
          throw new JevHttpError(
            `Jev returned HTTP ${status}`,
            status,
            retryAfterMs,
          );
        }
        throw new JevHttpError(
          `Jev returned HTTP ${status}`,
          status,
          retryAfterMs,
        );
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Inspect an error from a single attempt. Returns:
   * - `"fatal"` — do not retry (HTTP 4xx other than 408/429, JSON or
   *   shape validation errors, config errors).
   * - a number — minimum delay in ms (Retry-After ms, or 0 if none) for
   *   retriable failures.
   */
  #classifyError(error: unknown): number | "fatal" {
    if (error instanceof JevRetryAfterExceededError) {
      return "fatal";
    }
    if (error instanceof JevHttpError) {
      const status = error.status;
      if (!RETRY_STATUSES.has(status)) {
        return "fatal";
      }
      return error.retryAfterMs ?? 0;
    }
    if (
      error instanceof JevResponseError ||
      error instanceof ResponseValidationError ||
      error instanceof SyntaxError // JSON.parse failure
    ) {
      return "fatal";
    }
    if (error instanceof JevConfigError) {
      return "fatal";
    }
    // Treat anything else as a transport failure (timeout, connection
    // refused, body read interrupted). These are retriable.
    if (error instanceof Error) {
      // DOMException "AbortError" or undici "RequestAbortedError" both
      // indicate a timeout — retry.
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        return 0;
      }
      return 0;
    }
    return "fatal";
  }

  #wrapError(error: unknown, attempts: number): Error {
    if (error instanceof JevError) {
      // Add attempt count for context (preserving the original message).
      const suffix =
        attempts > 1 ? ` (after ${attempts} attempts)` : "";
      const wrapped = new JevError(
        `${error.message}${suffix}`,
        error,
      );
      // Preserve the original name for downstream `instanceof` checks.
      Object.defineProperty(wrapped, "name", { value: error.name });
      return wrapped;
    }
    const detail =
      error instanceof Error ? error.message : String(error);
    return new JevError(
      `Jev evaluation failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${detail}`,
      error,
    );
  }

  #notify(error: unknown, attempt: number): void {
    const detail =
      error instanceof Error
        ? error.stack ?? error.message
        : String(error);
    process.stderr.write(
      `ts-semantic-lint: jev attempt ${attempt} failed: ${detail}\n`,
    );
  }
}
