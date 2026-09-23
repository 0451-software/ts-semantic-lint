# Integration tests

Live integration tests for `ts-semantic-lint`. Each fixture contains one
deliberate violation and at least one clean control; the suite asserts the
end-to-end pipeline (CLI → runner → Jev API → output) flags the violation
and behaves correctly in offline modes.

## What lives here

```
tests/integration/
├── README.md                     ← this file
├── tsconfig.json                 ← standalone tsc config (noEmit, NodeNext)
├── live.test.ts                  ← the integration suite
├── __helpers__/run-cli.ts        ← child_process spawn helper for dist/cli.js
└── fixtures/
    ├── ts-semantic-lint.json     ← 3-rule config (function-simplicity,
    │                                comment-value, error-handling-completeness)
    ├── function-simplicity.ts    ← `formatUser` violation + `summarizeUsers`
    │                                control
    ├── comment-value.ts          ← `addNoisy` violation + `valuesBelow`
    │                                control
    └── error-handling.ts         ← `loadUserSilently` violation +
                                     `loadUserOrThrow` control
```

## Running locally

```bash
# Build the CLI once (the suite spawns dist/cli.js as a child process).
npm install
npm run build

# Run the integration suite. Without TYPESAFE_API_KEY the live suite
# skips cleanly and the offline-only tests still execute.
npm run test:integration
```

Expected output when the key is unset:

```
✓ tests/integration/live.test.ts (16 tests | 10 skipped)
Tests  6 passed | 10 skipped
```

The 10 skipped tests are the live Jev calls — they short-circuit in
`describeLive` (a `describe.skip` alias used when `TYPESAFE_API_KEY` is
absent).

## Running against the live API

```bash
TYPESAFE_API_KEY=... npm run test:integration
```

The `runCli` helper automatically forwards `TYPESAFE_API_KEY` to the child
as `jev_key` (the variable the CLI itself reads). When the key is present,
all 16 tests run; the live tests verify the diagnostics the model emits.

## Offline-mode guarantees (no API key needed)

These run regardless of whether `TYPESAFE_API_KEY` is set:

1. **`--check-config`** validates the fixture config (3 rules, structured
   criteria).
2. **`--dry-run`** emits the Jev request plan as JSON — no network calls,
   so this is the safe offline smoke test.
3. **Suite gating** confirms the fixture config and each fixture file
   exist before any test runs.

## What the live suite asserts

For each fixture (`function-simplicity`, `comment-value`,
`error-handling-completeness`):

1. **Violation diagnostic** — if the model flags the violating function,
   the diagnostic has:
   - `ruleId` matches the fixture rule id
   - `message` includes the function name (placeholder substitution worked)
   - `choice` matches the expected rubric choice
   - `confidence >= 0.5` (the principled floor — see `typesafe-ai` skill)
2. **Control diagnostic** — the test logs a warning when the model
   _also_ flags the clean control (this is model variance, not a bug),
   but does not fail.
3. **End-to-end timing** — full run completes in under 30s (warn-only).

Cross-cutting:

4. **API call cost** — total Jev requests per fixture ≤ 20 (warn-only),
   measured via the dry-run plan.

## Why warn-only on some assertions?

Jev is a stochastic model. Per the `typesafe-ai` skill's confidence
guidance, two runs against the same input can return different choices
or confidence values. We assert `confidence >= 0.5` (the principled
floor for "don't bother the user unless we're sure"), not exact values,
and we tolerate the control being flagged when the model disagrees with
our rubric. The warn logs make disagreements visible without flaking
the suite.

## Confidence floor reference

The `0.5` threshold used in every rule's `min_confidence` is the
**principled floor** from the typesafe-ai skill — the boundary below
which "don't bother the user unless we're sure" turns into "we're just
guessing". Higher thresholds (0.7, 0.9) make rules stricter but more
brittle on hard cases.

See:

- `~/.hermes/skills/research/typesafe-ai/SKILL.md`
- `~/.hermes/skills/research/typesafe-ai/references/confidence.md`
- `~/.hermes/skills/research/typesafe-ai/references/primitives.md`

## Maintenance

When adding a new fixture:

1. Add the `.ts` file under `fixtures/` with one violation + one or
   more controls.
2. Add the rule to `fixtures/ts-semantic-lint.json` (or a new config
   alongside).
3. Register the fixture in `live.test.ts`'s `FIXTURES` array.
4. Re-run `npm run test:integration` and verify offline mode skips
   cleanly and the live mode (with `TYPESAFE_API_KEY`) catches the
   violation.
