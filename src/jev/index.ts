/**
 * Public surface of the `jev` module — the TypeSafe Jev HTTP client and
 * its supporting types.
 */

export {
  JevClient,
  JevError,
  JevConfigError,
  JevHttpError,
  JevRetryAfterExceededError,
  JevResponseError,
  DEFAULT_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  resolvePackageVersion,
  type FetchLike,
  type JevClientOptions,
} from "./client.js";

export {
  type Question,
  type ChoiceQuestion,
  type ChoiceType,
  type Request,
  type Response,
  type ChoiceAnswer,
  type Probability,
  makeProbability,
  ProbabilityRangeError,
  validateQuestion,
  validateResponse,
  ResponseValidationError,
  toSharedAnswer,
} from "./types.js";

export {
  defaultPolicy,
  computeBackoff,
  applyDelay,
  mathRandom,
  realSleep,
  type RetryPolicy,
  type Sleeper,
  type RandomSource,
} from "./retry.js";

export { retryAfter, systemClock, type Clock } from "./http-status.js";
