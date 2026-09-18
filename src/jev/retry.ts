/**
 * Exponential-backoff retry scheduling.
 *
 * Mirrors backon's `ExponentialBuilder::default().with_min_delay(1s)
 * .with_factor(2.0).with_max_times(3).with_jitter()`. Total attempts
 * (initial + retries) cap at `maxAttempts`. Jitter scales each computed
 * backoff by a random factor in `[1, 2)` so the minimum is honored and
 * the maximum is the doubled value.
 *
 * The implementation is intentionally dependency-free so callers can
 * inject a virtual `sleep` and a deterministic `rng` for tests.
 */

/** Returns a pseudo-random number in `[0, 1)`. */
export type RandomSource = () => number;

/** A timer-like sleeper. Returns a promise that resolves after `ms`. */
export type Sleeper = (ms: number) => Promise<void>;

/** Default sleeper — `setTimeout`-based, fine for production. */
export const realSleep: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Default RNG — uniform `[0, 1)`. */
export const mathRandom: RandomSource = Math.random;

export interface RetryPolicy {
  /** Initial delay in milliseconds (before any exponential growth). */
  readonly minDelayMs: number;
  /** Geometric growth factor between successive attempts. */
  readonly factor: number;
  /** Maximum attempts including the first try (e.g. 4 = 1 initial + 3 retries). */
  readonly maxAttempts: number;
  /** Hard ceiling on any single delay (caps the exponential growth). */
  readonly maxDelayMs: number;
}

export const defaultPolicy: RetryPolicy = {
  minDelayMs: 1000,
  factor: 2,
  maxAttempts: 4,
  maxDelayMs: 60_000,
};

/**
 * Compute the backoff delay for a 1-indexed retry number (`nextAttempt`
 * counts the attempt that is *about* to run, starting at 2 because the
 * first attempt has no preceding delay).
 *
 * Example with the default policy and `rng = 0` (no jitter):
 * - `nextAttempt = 2` → 1_000 ms
 * - `nextAttempt = 3` → 2_000 ms
 * - `nextAttempt = 4` → 4_000 ms
 */
export function computeBackoff(
  nextAttempt: number,
  policy: RetryPolicy,
  rng: RandomSource = mathRandom,
): number {
  if (nextAttempt < 2) {
    return 0;
  }
  const exponent = nextAttempt - 2;
  const base = policy.minDelayMs * policy.factor ** exponent;
  const capped = Math.min(base, policy.maxDelayMs);
  // Jitter: scale `[1, 2)`. When `rng` returns 0, the lower bound is
  // returned unchanged so tests can disable jitter deterministically.
  const scale = 1 + rng();
  return Math.min(Math.floor(capped * scale), policy.maxDelayMs);
}

/**
 * Sleep for `ms` plus any extra delay (e.g. a server-supplied
 * `Retry-After`). The total is clamped to `maxDelayMs`.
 */
export async function applyDelay(
  baseMs: number,
  retryAfterMs: number | undefined,
  policy: RetryPolicy,
  sleep: Sleeper = realSleep,
): Promise<void> {
  const combined = Math.max(baseMs, retryAfterMs ?? 0);
  const clamped = Math.min(combined, policy.maxDelayMs);
  if (clamped > 0) {
    await sleep(clamped);
  }
}
