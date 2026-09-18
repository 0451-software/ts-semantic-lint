# Engineering Conventions — ts-semantic-lint

These contracts apply to every module. Module owners must read this before
starting work; conformance is verified at PR-review time.

## Module Boundaries

```
src/
├── analyzer/         — TS AST → ErisLint-shaped "states"
├── config/           — JSON config loading, extends/overrides, schema gen
├── jev/              — TypeSafe Jev HTTP client + retry
├── policy/           — Selectors, diagnostic thresholds, severity mapping
├── runner/           — Orchestration: scan → parse → batch → evaluate → emit
├── output/           — Diagnostic renderers (text, compact, json)
├── cli/              — commander arg parsing, command dispatch
└── index.ts          — Public package entrypoint (re-exports)
```

Each module exports a single top-level class or function from its `index.ts`.

## Common Types — Single Source of Truth

All shared types live in `src/types.ts` (one file, no folder). Modules import
from `@/types.js` (TS resolves to `types.ts` via NodeNext). Do **not** define
duplicates in module folders. Adding a type to `src/types.ts` requires a PR
review — it's the public contract.

## ErisLint → ts-semantic-lint Translation Map

| ErisLint concept | TS equivalent |
|---|---|
| `ra_ap_syntax` AST | `@typescript-eslint/typescript-estree` AST |
| `syntax.kind` (Function, Struct, …) | `TSESTree.Node['type']` (FunctionDeclaration, TSInterfaceDeclaration, …) |
| `syntax.file` | `{ path: string, content: string, text: string }` |
| `SyntaxTarget { kind, name, file, has_body, … }` | `LintedTarget` — see `src/types.ts` |
| Jev `Choice` question | `JevChoiceQuestion` — see `src/jev/types.ts` |
| `Rule` + `Diagnostic` | `Rule` + `Policy` — see `src/policy/types.ts` |
| `JevClient.evaluate()` | `evaluateTargets()` — see `src/runner/index.ts` |

## File Targets

Every selector references a `.ts` or `.tsx` file. **No JS, no JSX-only** in
v1 (matches the user's "TypeScript semantic linter" framing; multi-language
support is deferred). `.d.ts` files are excluded by default.

## Parallel-Safe Coding Rules

- **No cross-module imports during the parallel phase.** Each module exposes
  only types from `src/types.ts` and primitives from its own folder.
- **No shared mutable state.** Each module owns its own state; the runner is
  the only place that composes them.
- **No JSON fixtures in `src/`** — fixtures belong in `tests/__fixtures__/`.

## Test Conventions

- `vitest` for unit tests. Test files colocated: `src/foo/foo.ts` →
  `src/foo/foo.test.ts`.
- Integration tests under `tests/` use the same `vitest` runner.
- Every module must have at least one positive test (lint produces expected
  diagnostic) and one negative test (clean source produces no diagnostics).

## Build / Lint / Format

- `npm run typecheck` — `tsc --noEmit`, must pass with **zero errors**.
- `npm run lint` — ESLint flat config (in `eslint.config.mjs` — added by the
  cli worktree in pass 2).
- `npm run format:check` — Prettier, defaults.

## PR Discipline

Each module PR must:
1. Be self-contained: own tests, own fixtures, no broken imports if other
   modules don't exist yet.
2. Stub external module interfaces using `// TODO(pass-2):` markers in a
   single `src/__stubs__.ts` if needed — pass-2 modules replace these.
3. Include a module README at `src/<module>/README.md` summarizing the API.

## Final Integration (orchestrator-owned)

After all PRs land, the orchestrator:
1. Resolves any cross-module merge conflicts.
2. Wires `src/runner/index.ts` against real implementations.
3. Removes `src/__stubs__.ts`.
4. Writes `tests/integration.test.ts` end-to-end CLI test.
5. Writes `README.md` and `docs/configuration.md`.
