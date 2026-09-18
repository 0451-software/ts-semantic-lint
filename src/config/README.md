# `config` module

JSON configuration loader for `ts-semantic-lint`. Reads
`ts-semantic-lint.json`, validates it with Zod, resolves `extends` and
`rule_files`, and emits a compiled `Config` object the runner consumes.

Mirrors the behavioral contract of ErisLint's `src/config.rs` (392 lines)
but is a fresh implementation — no source reuse.

## Entry point

```ts
import {
  load,
  discover,
  loadFromDiscovery,
  Config,
  ConfigError,
  FileFilter,
  mergeFromPath,
  CONFIG_NAME,
  DEFAULT_INCLUDE,
  DEFAULT_MODEL,
} from "./config/index.js";
```

## Public API

| Symbol | Purpose |
|---|---|
| `CONFIG_NAME` | `"ts-semantic-lint.json"` |
| `load(path)` | Load + validate a config file from disk. |
| `discover(start)` | Walk up from `start` to the nearest config; stops at `.git`. |
| `loadFromDiscovery(start)` | `discover` + `load`. |
| `Config` | Compiled, immutable configuration. |
| `Config#settingFor(file, ruleId)` | Returns the last matching override's setting, or `undefined`. |
| `FileFilter` | Glob matcher (include / exclude / always-excluded dirs). |
| `mergeFromPath(path)` | Recursive `extends` + `rule_files` resolver (cycle + depth-checked). |
| `generateConfigSchema()` | JSON-Schema 2020-12 for the full config. |
| `generateRuleSchema()` | JSON-Schema 2020-12 for a single rule. |
| `ConfigError` | All config failures throw this; check `error.path` for the offending file. |

## Files in this module

| File | Role |
|---|---|
| `index.ts` | `Config` class + `load`, `discover`, `loadFromDiscovery`, `compile`. |
| `schemas.ts` | Zod schemas: `ConfigFile`, `Rule`, `Selector`, `Override`, `Question`, `Condition`, `DiagnosticPolicy`. |
| `filter.ts` | `FileFilter` (tinyglobby) + `ConfigError`. |
| `discovery.ts` | Ancestor walk + `.git` stop. |
| `merge.ts` | `extends` + `rule_files` resolution with cycle detection (max 64 depth). |
| `validation.ts` | Cross-field rules not expressible in Zod (override→rule references, choice→criteria references, has_body-only-for-function). |
| `json-schema.ts` | JSON-Schema generation via `zod-to-json-schema`. |
| `config.test.ts` | Vitest suite (15+ tests). |
| `__fixtures__/` | Valid and invalid sample configs. |

## Defaults

| Field | Default |
|---|---|
| `version` | `1` |
| `model` | `"jev-latest"` |
| `include` | `["**/*.ts", "**/*.tsx"]` |
| `exclude` | `[]` |
| `rules` | required (≥1) |

Always-excluded directories (cannot be opted into): `node_modules`,
`dist`, `.git`, `coverage`.

## Validation contract

These rules are enforced by the loader; a single failure rejects the
whole config:

1. `version` must be `1`.
2. `rules` must contain ≥1 rule.
3. Every rule id matches `[a-zA-Z0-9._-]+` and is non-empty.
4. `where.kind` must be a known TS AST kind (PascalCase or short alias).
5. `where.has_body` is only valid when `where.kind === "function"`.
6. `question.instructions` non-empty after trimming.
7. `question.criteria` has 2–255 entries; every key non-empty.
8. `diagnostics` has ≥1 entry; each `message` non-empty after trimming.
9. Every `diagnostics[*].when.choice` and `when.probability.choice`
   references a real criterion key.
10. `overrides[*].files` is non-empty; every rule id referenced by an
    override exists in `rules`.
11. `extends` cycles are rejected; chains deeper than 64 are rejected.

## Errors

Every failure throws `ConfigError`, which extends `Error` and carries the
offending file path on `error.path`:

```ts
try {
  await load("ts-semantic-lint.json");
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.path, err.message);
  }
}
```
