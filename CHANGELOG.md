# Changelog

All notable changes to `ts-semantic-lint` are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Combined CI cleanup — supersedes PRs #20, #23, #24, #25

This is the combined dependency-upgrades / ESLint v10 / vitest 5 / vite 8 / undici 8
stack landing as one PR. Each previous PR was reviewed independently; combining
them lets CI run the full stack in one go so the freshness gate exits 0 without a
deferred-table escape hatch.

Per-package landing summary:

| Package                                                       | Old        | New         | Source PR             |
| ------------------------------------------------------------- | ---------- | ----------- | --------------------- |
| `commander`                                                   | `^12.1.0`  | `^15.0.0`   | #20                   |
| `typescript`                                                  | `^5.7.3`   | `^5.9.3`    | #20                   |
| `@types/node`                                                 | `^22.10.5` | `^22.20.3`  | #20                   |
| `@typescript-eslint/{eslint-plugin,parser,typescript-estree}` | `^8.20.0`  | `^8.70.1`   | #20                   |
| `typescript-eslint` (new)                                     | —          | `^8.70.1`   | #23                   |
| `@eslint/js` (new)                                            | —          | `^10.0.1`   | #23                   |
| `eslint`                                                      | `^9.18.0`  | `^10.11.0`  | #23                   |
| `prettier`                                                    | `^3.4.2`   | `^3.9.9`    | #20                   |
| `tsx`                                                         | `^4.19.2`  | `^4.23.15`  | #20                   |
| `tinyglobby`                                                  | `^0.2.10`  | `^0.2.17`   | #20                   |
| `ignore`                                                      | `^7.0.0`   | `^7.0.10`   | #20                   |
| `vitest`                                                      | `^2.1.8`   | `^5.0.0`    | #17 (already on main) |
| `vite`                                                        | `^6.4.3`   | `^8.3.0`    | #25                   |
| `undici`                                                      | `^7.2.0`   | `^8.11.0`   | #24                   |
| `zod`                                                         | `^3.24.1`  | `^4.6.5`    | #22 (already on main) |
| `zod-to-json-schema`                                          | `^3.25.2`  | _removed_   | #22 (already on main) |
| `esbuild` (pnpm.overrides)                                    | `^0.25.0`  | `^0.28.0`   | #25                   |
| `engines.node`                                                | `>=20.0.0` | `>=22.19.0` | #20 + #23 + #24       |

### Security

- Bump `vitest` from `2.1.9` to `5.0.1` to clear 6 of 7 outstanding security
  advisories surfaced by `pnpm audit` on CI (PR #17). `vite` is now pinned to
  `^8.3.0` and `esbuild` to `^0.28.0` via `pnpm.overrides` so vitest's
  transitive copy of vite carries no `server.fs.deny` bypass,
  `launch-editor` NTLMv2 hash disclosure, optimized-deps `.map` path traversal,
  or dev-server CSRF advisory. Remaining advisories: 0
  (`pnpm audit --audit-level high` exits 0).

### ESLint v10 — new lint gate

- Adds `eslint.config.mjs` (ESLint v10 flat config; uses `typescript-eslint`
  meta-package per the typescript-eslint flat-config getting-started guide).
  Repo-wide ignores: `dist/**`, `coverage/**`, `node_modules/**`, `**/*.d.ts`,
  `**/__fixtures__/**`, `tests/integration/**`.
- Per-project overrides: `@typescript-eslint/no-unused-vars` allows
  `_`-prefixed names; `no-shadow-restricted-names` is disabled (the repo
  intentionally writes to `globalThis.__ts_semantic_lint_*` for embedder
  runtime access).
- Re-enables the lint gate on the reusable caller (`integration.yml` no longer
  passes `lint_enabled: false`). The deferral comment in the workflow is
  trimmed to match the remaining deferred cards (none — see "Dependency
  freshness" below).

### Source-level ESLint v10 fixups

- `src/analyzer/index.ts`: `throw new SyntaxError(formatParseError(error), { cause: error })`
  to satisfy `preserve-caught-error` (eslint:recommended v10). Also drops the
  unused `EXTRACTABLE_NODE_KINDS` import (it's re-exported via `export { ... } from`).
- `src/runner/extract.ts`: `throw new Error(\`cannot read ${file}: ${detail}\`, { cause: error })`.
- `src/runner/evaluate.ts`: `throw new Error(..., { cause: error })` on the
  Jev-evaluation failure path.
- `src/runner/runner.test.ts`: drops the dead `here` / `fx` / `resolve` /
  `fileURLToPath` fixture-path helper.
- `src/output/output.test.ts`: drops unused `DIAG_OTHER_A` import.

### CI

- `.github/workflows/integration.yml` no longer sets `lint_enabled: false`
  (default `true` runs the lint gate against the new flat config). Keeps
  `unit_test_script: "test:unit"` and `integration_test_script: "test:integration"`.
  Lint fixups above bring the new gate to a clean pass.
- The previous `fail_on_outdated: false` and `frozen_lockfile: false`
  escape hatches from PR #20 are NOT carried forward. All four deferred
  follow-up cards have landed here, so the freshness gate can run strictly
  and the lockfile is back in sync with `package.json`.

### Dependency freshness

`pnpm outdated --format json` is empty at this commit (all packages at their
target versions). Removing `fail_on_outdated: false` is therefore safe —
the gate runs, finds nothing outdated, and exits 0.

### Deferred to a follow-up card

| Package      | Old → Latest        | Reason to defer                                                                                                                                                                                                                              | Follow-up card          |
| ------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `typescript` | `^5.9.3` → `^7.0.2` | `@typescript-eslint/typescript-estree@8.70.1` peer dep is `typescript: ">=4.8.4 <6.1.0"`. Bumping past 6.x needs either `@typescript-eslint` v9 (lifted peer cap) or a substantial analyzer rewrite using `typescript` itself as the parser. | t_ef1f39fa follow-up #2 |

### Acceptance — verified by this PR's CI run

- Lint gate: PASS (ESLint v10 against the new flat config; 5 source fixups above).
- Typecheck gate: PASS.
- Build gate: PASS (commander 15 ESM-only, eslint 10, undici 8 — all hold).
- Unit tests gate: PASS (excludes `tests/integration/**` per the structural fix in #21).
- Format check gate: PASS (already on main since #18).
- Security audit gate: PASS (`pnpm audit --audit-level high` clean).
- Dependency freshness gate: PASS (`pnpm outdated --format json` is empty).
- Integration tests gate: PASS on weekly + dispatch with `TYPESAFE_API_KEY`; intentionally skipped on PR runs.
