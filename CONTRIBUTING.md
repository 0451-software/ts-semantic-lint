# ts-semantic-lint — Engineering Conventions

These contracts apply to every module. Module owners must read this before
starting work; conformance is verified at PR-review time.

## Module Boundaries

```
src/
├── analyzer/         — TS AST → ErisLint-shaped "states" (mirrors src/rust.rs)
├── config/           — JSON config loading, extends/overrides, schema gen (mirrors src/config.rs)
├── jev/              — TypeSafe Jev HTTP client + retry (mirrors src/jev.rs)
├── policy/           — Selectors, diagnostic thresholds, severity mapping (mirrors src/policy.rs)
├── runner/           — Orchestration: scan → parse → batch → evaluate → emit (mirrors src/runner.rs)
├── output/           — Diagnostic renderers (text, compact, json) (mirrors src/output.rs)
├── cli/              — commander arg parsing, command dispatch (mirrors src/main.rs)
└── index.ts          — Public package entrypoint (re-exports)
```

Each module exports a single top-level class or function from its `index.ts`.

## Common Types — Single Source of Truth

All shared types live in `src/types.ts` (one file, no folder). Modules import
from `./types.js` (TS resolves to `types.ts` via NodeNext). Do **not** define
duplicates in module folders. Adding a type to `src/types.ts` requires a PR
review — it's the public contract.

## Parallel-Safe Coding Rules

- **No cross-module imports during the parallel phase.** Each module exposes
  only types from `src/types.ts` and primitives from its own folder.
- **No shared mutable state.** Each module owns its own state; the runner is
  the only place that composes them.
- **No JSON fixtures in `src/`** — fixtures belong in `tests/__fixtures__/`.
- If you need to import from a sibling module that isn't built yet, import
  from `./types.js` and accept an injected function (DI). Don't reach into
  another module's internals.

## Test Conventions

- `vitest` for unit tests. Test files colocated: `src/foo/foo.ts` →
  `src/foo/foo.test.ts`.
- Integration tests under `tests/` use the same `vitest` runner.
- Every module must have at least one positive test (lint produces expected
  diagnostic) and one negative test (clean source produces no diagnostics).

## Build / Lint / Format

- `npm run typecheck` — `tsc --noEmit`, must pass with **zero errors**.
- `npm run lint` — ESLint v10 flat config (in `eslint.config.mjs`).
- `npm run format:check` — Prettier, defaults.

## PR Discipline

Each module PR must:

1. Be self-contained: own tests, own fixtures, no broken imports if other
   modules don't exist yet.
2. Stub external module interfaces via dependency injection if needed.
3. Include a module README at `src/<module>/README.md` summarizing the API.

## Final Integration (orchestrator-owned)

After all PRs land, the orchestrator:

1. Resolves any cross-module merge conflicts.
2. Wires `src/runner/index.ts` against real implementations.
3. Writes `tests/integration.test.ts` end-to-end CLI test.
4. Writes the user-facing `README.md` and `docs/configuration.md`.

## Reference Material

- **Original Rust implementation:** `/root/workspace/source/Eriskii--ErisLint/src/`
- **Carpeta original tests:** `/root/workspace/source/Eriskii--ErisLint/tests/`
- **README original:** `/root/workspace/source/Eriskii--ErisLint/README.md`

Each module's brief points at the specific original file to mirror. **Do not
copy source code** — this is a fresh implementation under MIT, not a fork.
Read the Rust source as behavioral reference only.
