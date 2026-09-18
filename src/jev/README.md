# `src/jev/` — TypeSafe Jev HTTP client

A TypeScript port of ErisLint's `src/jev.rs`. Wraps the TypeSafe Jev
`POST /v1/systemone` endpoint, validates the response shape, and retries
transient failures with exponential backoff.

## Public API

```ts
import { JevClient } from "./jev/index.js";

const client = new JevClient({ key: process.env.TYPESAFE_API_KEY! });
const response = await client.evaluate({
  model: "jev-latest",
  state: { name: "add", body: "function add(a, b) { return a + b; }" },
  questions: {
    quality: {
      type: "choice",
      instructions: "Is this code clear?",
      criteria: { clear: "Clear", unclear: "Unclear" },
    },
  },
});
```

### `JevClient`

| Method | Purpose |
|---|---|
| `new JevClient({ key, endpoint?, userAgent?, fetch?, sleep?, rng?, policy? })` | Construct a client. Throws on an empty key. |
| `client.evaluate(request): Promise<Response>` | POST `request` to the endpoint, retry transient failures, validate the response. |

The constructor accepts injection seams used by the test suite:

- `fetch` — a fetch-compatible function (defaults to `undici.fetch`).
- `sleep` — a `setTimeout`-like sleeper.
- `rng` — a `[0, 1)` random source for jitter.
- `policy` — override the default retry policy (`minDelayMs: 1000`, `factor: 2`, `maxAttempts: 4`, `maxDelayMs: 60_000`).

### Types

| Export | Purpose |
|---|---|
| `Question`, `ChoiceQuestion` | Wire-format question types (v1 supports `Choice` only). |
| `Request`, `Response`, `ChoiceAnswer` | Wire-format request / response shapes. |
| `Probability` | A branded `number` in `[0, 1]`. Construct via `makeProbability`. |
| `toSharedAnswer(answer)` | Convert a wire `ChoiceAnswer` into the shared `JevAnswer` from `src/types.ts`. |

### Errors

All errors extend `JevError` and live under `src/jev/client.ts`.

| Class | Meaning |
|---|---|
| `JevConfigError` | Misconfiguration (empty key). |
| `JevHttpError` | Non-retriable HTTP failure (4xx other than 408/429, 5xx after retries exhausted). |
| `JevRetryAfterExceededError` | `Retry-After` header > 60s. |
| `JevResponseError` | Response body could not be coerced into the expected shape. |

The `ResponseValidationError` thrown by `validateResponse` is re-exported
from `./types.js` and is treated as a permanent failure by the retry
loop.

## Retry behaviour

Mirrors `backon::ExponentialBuilder::default().with_min_delay(1s)
.with_factor(2.0).with_max_times(3).with_jitter()`:

- **Max attempts:** 4 (initial + 3 retries).
- **Backoff:** `1s`, `2s`, `4s` with up to 100% jitter (`delay = base * [1, 2)`).
- **Retriable failures:** HTTP `408`, `429`, `500`, `502`, `503`, `504`,
  and any transport-level error (timeout, connection reset, aborted body).
- **`Retry-After` header:** parsed as either numeric seconds or an
  IMF-fixdate (`Sun, 06 Nov 1994 08:49:37 GMT`). The retry waits at
  least that long (clamped to `maxDelayMs`); a `Retry-After` > 60s fails
  immediately.
- **Permanent failures:** HTTP `401`, `403`, other 4xx, malformed JSON,
  shape mismatches. Failures are not retried.

When a retry is scheduled, a notice is written to `process.stderr`:

```
ts-semantic-lint: jev attempt 1 failed: Jev returned HTTP 500
```

## HTTP behaviour

- **Endpoint:** `https://api.typesafe.ai/v1/systemone` (overridable).
- **Auth:** `Authorization: Bearer <key>`.
- **User-Agent:** `ts-semantic-lint/<version>` (version resolved from
  `package.json` via `fs.readFileSync`).
- **Redirects:** `manual` — the client never follows them.
- **Timeouts:** 60 s per request via `AbortSignal.timeout`, 10 s connect
  timeout via `undici.Agent({ connectTimeout: 10_000 })`.

## File map

```
src/jev/
├── index.ts           public re-exports
├── client.ts          JevClient class + errors + JSON coercion
├── retry.ts           exponential backoff + jitter (no external deps)
├── http-status.ts     retryAfter(headerValue, now) parser
├── types.ts           Question / Request / Response / Probability
├── jev.test.ts        vitest suite (36 tests, no real network calls)
└── README.md          this file
```
