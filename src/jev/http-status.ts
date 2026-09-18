/**
 * Retry-After header parsing.
 *
 * The HTTP `Retry-After` header can carry either a non-negative integer
 * (delay-seconds) or an HTTP-date (RFC 7231 / RFC 9110). Anything else
 * (including empty, negative, signed, or unparseable values) yields
 * `undefined` so the caller can fall back to the standard exponential
 * backoff schedule.
 *
 * Port of `retry_after` from `src/jev.rs`.
 */

export interface Clock {
  /** Current wall-clock time, in milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = {
  now: (): number => Date.now(),
};

/**
 * Parse a `Retry-After` header value and return the delay to wait (in ms)
 * relative to `clock.now()`. Returns `undefined` when the header is missing,
 * empty, or unparseable.
 *
 * - `"0"` and `"5"` → numeric seconds.
 * - `"Wed, 21 Oct 2015 07:28:15 GMT"` → HTTP-date, clamped to ≥ 0.
 * - `""`, `"invalid"`, `"-1"`, `"+1"` → `undefined`.
 *
 * Overflowing numeric values saturate to `Number.MAX_SAFE_INTEGER` so the
 * caller (which already enforces a 60s ceiling) can short-circuit.
 */
export function retryAfter(
  headerValue: string | null | undefined,
  clock: Clock = systemClock,
): number | undefined {
  if (headerValue === null || headerValue === undefined) {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  // Numeric seconds form: only ASCII digits, no sign. RFC 9110 §10.2.3
  // allows only non-negative integers; reject signed / decimal values.
  if (/^[0-9]+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return undefined;
    }
    // Express the delay in ms; saturate on overflow so downstream
    // comparisons remain meaningful.
    if (seconds > Number.MAX_SAFE_INTEGER / 1000) {
      return Number.MAX_SAFE_INTEGER;
    }
    return seconds * 1000;
  }
  // HTTP-date form. RFC 9110 §10.2.3 mandates an IMF-fixdate:
  //   Sun, 06 Nov 1994 08:49:37 GMT
  // V8's `Date.parse` will happily turn things like "-1" or "+1" into
  // real timestamps (year -1 / +1 epoch), so enforce the exact shape
  // before delegating.
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  const deltaMs = parsed - clock.now();
  return deltaMs > 0 ? deltaMs : 0;
}
