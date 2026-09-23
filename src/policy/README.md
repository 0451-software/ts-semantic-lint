# policy

Selector matching, condition evaluation, severity resolution, and the
top-level rule-to-diagnostic evaluator. Mirrors ErisLint's `src/policy.rs`
(140 lines of behavioral reference). This is the smallest of the four
foundation modules.

## Public API

| Symbol                                                | Kind     | Description                                           |
| ----------------------------------------------------- | -------- | ----------------------------------------------------- |
| `evaluateRule(rule, target, answer, overrideSetting)` | function | Produce the first matching `Diagnostic`, or `null`.   |
| `matches(condition, answer)`                          | function | Does a `Condition` accept this `JevAnswer`?           |
| `matchesSelector(selector, target)`                   | function | Does a `Selector` describe this `LintedTarget`?       |
| `resolveSeverity(policyLevel, override)`              | function | Combine a policy's level with an optional override.   |
| `formatMessage(template, target)`                     | function | Substitute `{name}`, `{kind}`, `{file}` placeholders. |
| `Rule`, `Policy`, `Condition`, `OverrideSetting`      | type     | Policy-module type contracts (in `types.ts`).         |

## Design Notes

- **No cross-module imports.** The only external type imports are from
  `../types.js` (the shared cross-cutting types). Policy-specific types
  (`Rule`, `Policy`, `Condition`, `OverrideSetting`) live in
  `src/policy/types.ts`.
- **All set selector fields are ANDed.** `undefined` means wildcard.
- **File globs are gitignore-style.** Patterns in `selector.files` must
  match `target.file` (any one); patterns in `selector.exclude` must not.
  Implementation uses the `ignore` package for per-path testing — see
  selector.ts for rationale.
- **First matching policy wins.** `evaluateRule` walks `rule.diagnostics`
  in order and returns the first hit.
- **`Override = "off"` suppresses the target** entirely (returns `null`).
  `"error"` upgrades; `"warn"` keeps the policy's intrinsic level (does
  not downgrade an `"error"` policy).

## Invariants

- `matchesSelector` is pure and synchronous.
- `evaluateRule` is pure.
- All public functions are total — no exceptions thrown on malformed
  inputs (e.g. a bad regex in `namePattern` fails closed rather than
  throwing).

## Testing

`src/policy/policy.test.ts` covers all required cases from the brief
plus a few defensive ones (malformed regex, undefined name, contradictory
confidence bounds, default message fallback).

```bash
npx vitest run src/policy
```
