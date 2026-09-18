# ts-semantic-lint

Configurable TypeScript semantic lint rules evaluated by [Jev](https://docs.typesafe.ai/api).
Jev receives the selected TypeScript source and surrounding context from this tool, returns
structured judgments, and your rule definition decides which judgments become warnings or errors.

![MIT](https://img.shields.io/badge/license-MIT-blue)
![Node >=20](https://img.shields.io/badge/node-%E2%89%A520-green)

---

## What it is

Traditional linters — ESLint, Biome, TypeScript itself — operate on syntax and patterns.
They can tell you that `try { ... } catch (e) {}` is *syntactically valid*. They can't tell
you that it's *silently swallowing an error*. `ts-semantic-lint` asks a model to make that
judgment, and you write the rule that decides what to do with the answer. The diagnostic
thresholds, severities, and messages are yours; the model only does the part that requires
reading the code for meaning.

---

## Comparison with ESLint and Biome

ESLint and Biome are fast, deterministic, and right about almost everything syntactic.
They are not the right tool for the questions below. The table shows one row per example
rule shipped with this repository; each is a real judgment that a syntax linter cannot
make because the code parses cleanly.

| Smell | ESLint rule? | Biome rule? | `ts-semantic-lint`? |
| --- | --- | --- | --- |
| Function with avoidable boolean-toggle branching | No (the AST is valid) | No | Yes (`function-simplicity`) |
| JSDoc that restates the parameter types | No (`valid-jsdoc` checks syntax, not value) | No | Yes (`comment-value`) |
| `try { ... } catch {}` silently swallowing | `no-empty` matches the syntax but flags every empty catch the same way | `noEmptyCatch` matches the syntax but flags every empty catch the same way | Yes (`error-handling-completeness`) — distinguishes empty-because-intentional from empty-because-careless |
| Naming that misleads about side effects | `camelcase` is style only | No | Yes (configurable; `name-clarity` is the example) |

The third row is the one that gets attention. `no-empty` and `noEmptyCatch` flag every
empty catch block identically. A semantic rule can tell you which ones are intentionally
empty (a documented "best-effort, ignore" branch) and which ones hide a real failure.

---

## Quickstart

You need Node 20 or newer and a TypeSafe API key.

```bash
npm install -g ts-semantic-lint

cd your-typescript-project

export jev_key='your-typesafe-api-key'  # exactly `jev_key`, including case

cat > ts-semantic-lint.json <<'EOF'
{
  "version": 1,
  "model": "jev-latest",
  "rules": [ ... your rules ... ]
}
EOF

ts-semantic-lint --check-config    # offline — validates the config
ts-semantic-lint --dry-run         # offline — shows the requests that would be sent
ts-semantic-lint                   # live — runs against your project
```

The environment variable is exactly **`jev_key`**, including case. Keys belong in a
shell profile, a CI secret store, or your secret manager — never in the config file and
never in version control. `.env` files are not loaded automatically.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No errors (warnings allowed) |
| `1` | Errors present, or warnings present with `--deny-warnings` |
| `2` | Config, parse, auth, network, or other operational failure |

Wire `2` separately in CI — it means the linter itself did not run, not that the code is bad.

---

## Worked example: the three example rules

The repository ships three example rules you can copy verbatim, adapt, or use as a
template for your own. The config below uses the **structured criteria** form, where
each choice is an object with `what` (the rule's meaning), and optional `not_for`
(boundary cases that should not be matched) and `examples` (concrete cases).

### `function-simplicity`

Judges whether a function carries avoidable complexity — branching, indirection, or
bookkeeping that obscures the work. Length alone is not complexity.

```typescript
// Bad: a boolean flag selects between two near-identical branches.
function formatUser(user: User, verbose: boolean): string {
  if (verbose) {
    return `${user.name} <${user.email}> (${user.role})`;
  }
  return `${user.name} <${user.email}>`;
}

// Good: one job, one shape.
function formatUser(user: User): string {
  return `${user.name} <${user.email}>`;
}
```

Config:

```json
{
  "id": "function-simplicity",
  "where": { "kind": "function", "has_body": true },
  "context": "enclosing",
  "question": {
    "type": "choice",
    "instructions": {
      "question": "Is this TypeScript function appropriately simple for its purpose?",
      "inspect": "`name`, `signature`, `body`",
      "focus": "Judge avoidable complexity — branching, indirection, or bookkeeping that obscures the work. Length alone is not complexity."
    },
    "criteria": {
      "simple": {
        "what": "Each line carries its weight. Any branching or indirection is justified by the function's responsibility.",
        "not_for": "Long functions whose length is justified by their responsibility (parsers, formatters, validators with many cases)."
      },
      "needlessly_complex": {
        "what": "There is avoidable branching, indirection, or bookkeeping that a clearer version of the same function would not need.",
        "examples": [
          "A boolean flag that selects between two near-identical branches",
          "An intermediate variable that holds a value used exactly once on the next line",
          "Defensive null checks for values that the type system has already excluded"
        ]
      },
      "insufficient_context": {
        "what": "Without the file's surrounding code, the call sites, or the spec, this judgment can't be made reliably."
      }
    }
  },
  "diagnostics": [
    {
      "when": { "choice": "needlessly_complex", "min_confidence": 0.5 },
      "level": "warn",
      "message": "Consider whether {name} can express its work more directly."
    }
  ]
}
```

Output (text format, default):

```
src/format.ts:12:1
  warn  function-simplicity  Consider whether formatUser can express its work more directly.
  note  choice=needlessly_complex confidence=0.71
```

A compact single-line output is planned but not yet available in this build.

The same rule written with the plain-string form for `instructions` and `criteria` —
no behavioral difference, just shorter to read:

```json
{
  "id": "function-simplicity",
  "where": { "kind": "function", "has_body": true },
  "context": "enclosing",
  "question": {
    "type": "choice",
    "instructions": "Is this TypeScript function appropriately simple for its purpose? Judge avoidable complexity — branching, indirection, or bookkeeping that obscures the work. Length alone is not complexity.",
    "criteria": {
      "simple": "Each line carries its weight. Any branching or indirection is justified by the function's responsibility. Not for long functions whose length is justified by their responsibility (parsers, formatters, validators with many cases).",
      "needlessly_complex": "There is avoidable branching, indirection, or bookkeeping that a clearer version of the same function would not need. Examples: a boolean flag that selects between two near-identical branches; an intermediate variable that holds a value used exactly once on the next line; defensive null checks for values that the type system has already excluded.",
      "insufficient_context": "Without the file's surrounding code, the call sites, or the spec, this judgment can't be made reliably."
    }
  },
  "diagnostics": [
    {
      "when": { "choice": "needlessly_complex", "min_confidence": 0.5 },
      "level": "warn",
      "message": "Consider whether {name} can express its work more directly."
    }
  ]
}
```

Use the structured form (the one above this) when your criteria need `not_for` boundaries
or `examples` arrays — the model has measurably tighter distributions when given those. Use
the plain-string form (this one) for short self-explanatory rules where each criterion is
clear from its name. Both forms can be mixed within one question: a single `criteria` object
may have some string values and some object values.

### `comment-value`

Judges whether the JSDoc on a function adds information beyond what the signature and
body already convey. Comments that restate the name, restate parameter types, narrate
the obvious, or are stale are noise.

```typescript
// Bad: restates the signature.
/**
 * Adds two numbers.
 * @param a the first number
 * @param b the second number
 * @returns the sum of a and b
 */
function add(a: number, b: number): number {
  return a + b;
}

// Good: documents a non-obvious invariant.
/**
 * Returns a precision-weighted mean; weights are non-negative and need not sum to 1.
 */
function weightedMean(values: number[], weights: number[]): number {
  // ...
}
```

Config:

```json
{
  "id": "comment-value",
  "where": { "kind": "function", "has_body": true },
  "context": "enclosing",
  "question": {
    "type": "choice",
    "instructions": {
      "question": "Does the JSDoc on this function add information beyond what the signature and body already convey?",
      "inspect": "`name`, `signature`, `docs`",
      "focus": "Comments that restate the name, restate parameter types, narrate the obvious, or are stale are noise."
    },
    "criteria": {
      "useful": {
        "what": "The comment captures intent, invariants, edge cases, units, ordering guarantees, preconditions, postconditions, or rationale that the code does not already express.",
        "examples": [
          "An exclusivity or inclusivity bound that the type signature cannot express",
          "A reason a workaround is in place",
          "A non-obvious invariant the function depends on"
        ]
      },
      "noise": {
        "what": "The comment restates the function name, paraphrases parameter types, narrates what the code obviously does, or is stale / wrong.",
        "examples": [
          "'Adds two numbers' on add(a, b)",
          "A @param a the first number block that says nothing the signature didn't",
          "A TODO that refers to a fixed bug"
        ]
      },
      "insufficient_context": {
        "what": "Without seeing the function's callers or the surrounding code, this judgment can't be made reliably."
      }
    }
  },
  "diagnostics": [
    {
      "when": { "choice": "noise", "min_confidence": 0.5 },
      "level": "warn",
      "message": "Comment on {name} restates the obvious or adds no information."
    }
  ]
}
```

Output:

```
src/math.ts:1:1
  warn  comment-value  Comment on add restates the obvious or adds no information.
  note  choice=noise confidence=0.83
```

### `error-handling-completeness`

Judges whether a function handles errors in a way that is appropriate for its role and
contract. Silently swallowing an error is almost always wrong — but an explicitly
documented "best-effort, ignore" branch is occasionally correct.

```typescript
// Bad: swallows the failure silently and pretends nothing happened.
async function getSettings(): Promise<Settings> {
  try {
    return await fetchSettings();
  } catch (e) {
    return {} as Settings;  // caller has no idea the fetch failed
  }
}

// Good: surfaces the failure with context.
async function getSettings(): Promise<Settings> {
  try {
    return await fetchSettings();
  } catch (e) {
    throw new SettingsLoadError("Failed to fetch settings", { cause: e });
  }
}
```

Config:

```json
{
  "id": "error-handling-completeness",
  "where": { "kind": "function", "has_body": true },
  "context": "enclosing",
  "question": {
    "type": "choice",
    "instructions": {
      "question": "Does this function handle errors in a way that's appropriate for its role and contract?",
      "inspect": "`name`, `signature`, `body`",
      "focus": "Consider whether thrown errors or rejected promises are caught at the right level, propagated with context, or silently swallowed. Silently swallowing errors is almost always wrong."
    },
    "criteria": {
      "appropriate": {
        "what": "Errors are caught at the boundary that knows enough to handle them, propagated with context, or rethrown deliberately. No silent swallowing."
      },
      "swallowed": {
        "what": "A catch block, .catch(), or Promise rejection handler exists only to suppress the error — logging nothing, rethrowing nothing, and returning a default that hides the failure.",
        "examples": [
          "`try { ... } catch (e) {}`",
          "`.catch(() => {})` on a fetch without a comment explaining why",
          "Returning `null` / `[]` / `false` inside a catch without surfacing the failure"
        ]
      },
      "insufficient_context": {
        "what": "Without seeing the function's callers, the right level for error handling can't be determined."
      }
    }
  },
  "diagnostics": [
    {
      "when": { "choice": "swallowed", "min_confidence": 0.5 },
      "level": "warn",
      "message": "Errors are being silently swallowed in {name}; either handle them or propagate with context."
    }
  ]
}
```

Output:

```
src/settings.ts:7:1
  warn  error-handling-completeness  Errors are being silently swallowed in getSettings; either handle them or propagate with context.
  note  choice=swallowed confidence=0.76
```

---

## Configuring your own rule

Every rule has the same four-part shape.

| Field | Purpose |
| --- | --- |
| `id` | A stable identifier for the rule; appears in diagnostics and any `--format json` output |
| `where` | Which AST nodes the rule targets — a `kind` (e.g. `function`, `arrow`, `method`), plus optional shape predicates |
| `question` | What to ask Jev — a `type` (`choice` is the only kind supported today), the prompt, the criteria, and the field set Jev may inspect |
| `diagnostics` | Which Jev answers become findings; each diagnostic pairs a `when` condition (the choice and a `min_confidence` floor) with a `level` (`warn` or `error`) and a `message` template |

Three things to know about the `question`:

- **`context`** controls how much surrounding code Jev receives: `target` (just the node),
  `enclosing` (the smallest enclosing function or block), or `file` (the whole file).
  `enclosing` is the right default for most rules; `file` is rarely worth the token cost.
- **`instructions`** is either a plain string or a `{question, focus?, inspect?}` object.
  Use the object form when you want to give Jev a *focus* clause (the most influential part
  of the prompt — for `function-simplicity`, the focus phrase is exactly *"Length alone
  is not complexity"*; without it the rule over-matches) or an `inspect` pointer to the
  state fields the model should read first. Use the plain string form when the question
  is short and self-explanatory.
- **`criteria`** accepts either a plain string or a `{what, not_for?, examples?}` object
  per choice. Use the structured form when the criteria need boundaries (the `not_for`
  field) or concrete examples (the `examples` array) to pin down coverage; use the plain
  string form for simple questions where each criterion is self-evident from its name.
  The Jev HTTP wire shape is always flat strings — structured forms are flattened at the
  request boundary, so the model sees the same thing either way.

Three things to know about `diagnostics`:

- **`min_confidence`** is your threshold for acting on a judgment. `0.5` is the principled
  floor — at that point Jev is leaning toward the choice but is not certain. Raise to
  `0.7` or higher for stricter linting, at the cost of more missed cases.
- **`level: "error"`** makes the finding contribute to exit code `1`. **`warn`** does not
  unless you pass `--deny-warnings`.
- **`message`** is a template. `{name}` is the most useful token; the rule's id, the
  matched choice, and the confidence are available too.

For the full schema, see [`docs/configuration.md`](docs/configuration.md).

---

## Limitations

These are honest, not warnings to talk past.

**Latency.** A typical run with 64 concurrent jobs adds one to three seconds over a fast
local lint, dominated by the Jev round-trip. Run this on changed files in a pre-commit
hook; running it on every file on every push is overkill.

**Cost.** Every lint run makes one Jev API call per matched rule per target. A project
with 1,000 functions and three rules enabled is 3,000 calls. Tune your `where:` selectors
to scope rules tightly, and use `--dry-run` to preview the request volume before
committing to a CI run.

**Confidence varies.** Jev returns a distribution over the choices, not a verdict. Your
`min_confidence` threshold is your judgment about how concentrated that distribution
needs to be before you act on it. `0.5` is the principled floor; `0.7` is strict;
`0.9` will mostly stay silent. There is no universally correct number — tune it against
your own codebase.

**Not a replacement for the type checker or ESLint.** Run `tsc --noEmit` and ESLint first.
Run `ts-semantic-lint` as a quality layer on top — it answers questions the others
cannot answer, and it cannot answer questions they trivially can.

**Model drift.** Judgments are not byte-for-byte reproducible across model versions.
When you bump `model` in your config, expect to revisit thresholds and to triage a
small number of new findings on your existing code.

---

## Development

The source is plain TypeScript; no transpiler beyond `tsc`. Node 20 or newer is required.

```bash
git clone https://github.com/0451-software/ts-semantic-lint.git
cd ts-semantic-lint
npm install
```

Common scripts:

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the unit test suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint over the source tree |
| `npm run lint:fix` | ESLint with `--fix` |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check (CI gate) |
| `npm run test:integration` | Live integration suite — requires `TYPESAFE_API_KEY` |

The integration suite makes real Jev calls. Keep the API key out of the repo and use
a throwaway project; the suite asserts on request shape, not on the model's specific
verdicts, so it should not generate billable volume.

---

## License

MIT. See [`LICENSE`](LICENSE).

The original ErisLint is AGPL-3.0. This codebase is a fresh TypeScript implementation;
the rules' structure and configuration style are a behavioral reference, not a copy of
the Rust source.

---

## Links

- [TypeSafe Jev API docs](https://docs.typesafe.ai/api)
- [Confidence guidance](https://docs.typesafe.ai/confidence)
- [Configuration reference](docs/configuration.md)
- The original [ErisLint](https://github.com/Eriskii/ErisLint) — Rust, AGPL-3.0
