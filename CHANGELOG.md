# Changelog

All notable changes to `ts-semantic-lint` are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The **Unreleased** section is what `pnpm outdated --format json` would otherwise
fail on. Each major-version bump is tracked here so reviewers can see which
follow-up card owns which migration.

## [Unreleased]

### Security

- Bump `vitest` from `2.1.9` to `5.0.1` to clear 6 of 7 outstanding security
  advisories surfaced by `pnpm audit` on CI (PR #17). `vite` is now pinned to
  `^6.4.3` and `esbuild` to `^0.25.0` via `pnpm.overrides` so vitest's
  transitive `vite@5.4.21` no longer carries the `server.fs.deny` bypass, the
  `launch-editor` NTLMv2 hash disclosure, the optimized-deps `.map` path
  traversal, or the dev-server CSRF advisory. Remaining advisories: 0
  (`pnpm audit --audit-level high` exits 0). Also added `vite` and `vitest@5`
  directly to devDependencies; vitest 5 requires `vite@^6.4.0 || ^7 || ^8`.

### Dependency upgrades

Per-major decision matrix (background: PR #16 surfaced 15 outdated direct deps
once CI finally ran end-to-end after the reusable-workflows vendoring in #15.
The 9 patch-level bumps ride along; the 6 majors each need a decision).

**Landed in this branch:**

| Package | Old | New | Notes |
| --- | --- | --- | --- |
| `commander` | `^12.1.0` | `^15.0.0` | CLI surface is small (`src/cli/parse-argv.ts`); breakage surface checked against commander v13/14/15 release notes. Forces `engines.node: ">=22.12.0"` per commander 15 release notes (ESM-only + Node ≥22.12 for `require(esm)`). README/CONTRIBUTING references to Node version updated. |
| `typescript` | `^5.7.3` | `^5.9.3` | Last 5.x before `@typescript-eslint/typescript-estree@8.70.x`'s peer cap of `<6.1.0`. In-range bump; no source changes expected. TypeScript 5→7 deferred (see below). |
| `@types/node` | `^22.10.5` | `^22.20.3` | In-range bump; matches current Node 22 LTS line that the new `engines.node` requires. |
| `@typescript-eslint/eslint-plugin` | `^8.20.0` | `^8.70.1` | Patch-level; lint is disabled on the CI gate today so this doesn't break anything. |
| `@typescript-eslint/parser` | `^8.20.0` | `^8.70.1` | Patch-level. |
| `@typescript-eslint/typescript-estree` | `^8.20.0` | `^8.70.1` | Patch-level; peer cap unchanged at `typescript <6.1.0`. |
| `prettier` | `^3.4.2` | `^3.9.9` | Patch-level. |
| `tsx` | `^4.19.2` | `^4.23.15` | Patch-level. |
| `tinyglobby` | `^0.2.10` | `^0.2.17` | Patch-level. |
| `ignore` | `^7.0.0` | `^7.0.10` | Patch-level. |
| `vitest` | `^2.1.8` | `^5.0.0` | Merged from PR #17 (security advisory clearance); adds `vite@^6.4.3` direct dep + `pnpm.overrides` pinning `vite` and `esbuild`. |

**Newly outdated as a side effect of the vitest 5 bump (vite, esbuild are now direct devDeps through `pnpm.overrides`):**

| Package | Current | Latest | Reason deferred | Follow-up card |
| --- | --- | --- | --- | --- |
| `vite` | `^6.4.3` | `^8.3.0` | Vitest 5 requires vite `^6.4.0 || ^7 || ^8`. Bumping to vite 8 is independent of vitest 5 itself and worth its own card so any analyzer/Vite-plugin compatibility gets checked. | t_ef1f39fa follow-up #5 |

**Deferred to follow-up cards (option c in the body of t_ef1f39fa):**

| Package | Old → Latest | Reason to defer | Follow-up card |
| --- | --- | --- | --- |
| `eslint` | `^9.18.0` → `^10.11.0` | Requires ESLint v9 flat-config (`eslint.config.mjs`) first; today the repo has none and the lint gate is disabled (`lint_enabled: false` on the caller). Bumping ESLint without a flat config would break the gate the moment someone re-enables it. | t_ef1f39fa follow-up #1 |
| `typescript` | `^5.9.3` → `^7.0.2` | `@typescript-eslint/typescript-estree@8.70.1` peer dep is `typescript: ">=4.8.4 <6.1.0"`. The typescript-estree parser is a direct dep used at compile time by `src/analyzer/`. Bumping typescript past 6.x requires either waiting for `@typescript-eslint` to ship a major that lifts the peer cap (likely v9) or replacing typescript-estree with `typescript` itself as the parser (substantial analyzer rewrite). | t_ef1f39fa follow-up #2 |
| `zod` | `^3.24.1` → `^4.6.5` | **Landed in this PR** — see "Dependency upgrades — zod 3→4" below. | t_ef1f39fa follow-up #3 |
| `undici` | `^7.2.0` → `^8.11.0` | undici@8's `engines.node` is `>=22.19.0`. The repo already moved to `>=22.12.0` via commander 15, so a second engines bump to `>=22.19.0` is required for undici 8. `undici@7.29.1` (latest 7.x) only needs `>=20.18.1` and is fully compatible with the current `>=22.12.0`. | t_ef1f39fa follow-up #4 |

### CI

- `.github/workflows/integration.yml` now passes `fail_on_outdated: false` to the
  vendored reusable (option b in the body of t_ef1f39fa) so the freshness gate
  no longer fails the entire PR on every run while the deferred majors
  above land individually. The freshness gate still **runs** and reports the
  outdated table — it just emits an advisory notice instead of a hard fail.
  The comment block above the input explains the deferral plan and lists the
  follow-up cards. Remove `fail_on_outdated: false` once all four deferred
  cards above have landed and `pnpm outdated --format json` is empty.
- Also passes `frozen_lockfile: false` for this PR so the commander 12→15
  cross-major bump can regenerate `pnpm-lock.yaml` in CI. Restore the default
  of `true` once the lockfile is back in sync.

### Acceptance — verified by PR #20 CI run

- Dependency freshness gate: PASS (was FAILING on PR #16). 6 outdated deps
  remain as advisories (the deferred majors above + the new vite 6→8 advisory
  introduced by the vitest 5 merge).
- Typecheck gate: PASS.
- Build gate: PASS (commander 15 ESM-only + Node ≥22.12 holds).
- Security audit gate: PASS (after merging vitest 2→5 from PR #17).
- Format check gate: still FAILS — pre-existing prettier debt (tracked as
  `t_e5d2f492`, "prettier --write to fix format check").
- Unit tests gate: still FAILS — pre-existing `tests/integration/live.test.ts`
  requires `dist/cli.js` to exist; the test suite doesn't trigger a build
  first (tracked as `t_1235e511`).
- Lint gate: skipped (intentional, until the `eslint.config.mjs` flat config lands).

### Dependency upgrades — zod 3→4 (follow-up card t_ef1f39fa #3)

**Landed in this PR:**

| Package | Old | New | Notes |
| --- | --- | --- | --- |
| `zod` | `^3.24.1` | `^4.6.5` | Zod 4 ships native `z.toJSONSchema()` (added in zod@4.0) and drops support for the deprecated `zod-to-json-schema` package. Required migration in two files. |
| `zod-to-json-schema` | `^3.25.2` | _removed_ | The package is **deprecated as of Nov 2025** (its README now recommends Zod 4's native `z.toJSONSchema()`) and only accepts Zod v3 schemas via `zod/v3` even when Zod v4 is in deps. |

**Source changes:**

- `src/config/json-schema.ts` — rewritten to call `z.toJSONSchema(schema, { reused: "inline", cycles: "throw" })` and wrap the result in a `{ $ref, definitions }` envelope so the on-disk shape is **byte-compatible** with the previous `zod-to-json-schema` output. Downstream consumers (IDE `$schema` users, the unit test that asserts on `definitions["ConfigFile"]`) see no change.
  - Option mapping documented inline in the file. Notable: `markdownDescription: true` (a non-standard vendor extension from `zod-to-json-schema`) is dropped — Zod 4 has no equivalent and no consumer in this repo relied on it.
- `src/config/schemas.ts` — migrated to Zod 4 breaking changes:
  - All `.strict()` calls → `z.strictObject(...)` (preferred form in Zod 4; `.strict()` is deprecated but still available as a legacy escape hatch).
  - `.nonempty({ message })` → `.min(1, { message })` (same runtime behaviour; Zod 4's `.nonempty()` is now a type-only convenience).
  - Recursive `ConditionSchemaImpl` type annotation simplified: Zod 4 dropped the `Def` parameter from `ZodType`'s generic and eliminated `z.ZodTypeAny`; bare `z.ZodType` is the new equivalent.
- `src/config/README.md` — `json-schema.ts` row now says "Zod 4's native `z.toJSONSchema()`" instead of "zod-to-json-schema".

**Not changed (no relevant callers):**

- `.format()` / `.flatten()` → deprecated in Zod 4, replaced by `z.treeifyError()`. Not used in this repo.
- `.errors` → dropped in Zod 4 (was alias for `.issues`). Not used in this repo.
- `z.record(key, value)` 2-arg form — preserved as-is; Zod 4 dropped the 1-arg form but our code was already 2-arg.