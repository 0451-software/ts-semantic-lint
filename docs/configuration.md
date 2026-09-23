# Configuration reference

This is the schema reference for `ts-semantic-lint.json`. The README walks through
worked examples; this document is the formal shape.

## Top-level shape

```typescript
{
  $schema?: string,           // URL to a JSON Schema (use --schema config to generate)
  version: 1,                 // literal 1; default if omitted
  model?: string,             // Jev model id (default: "jev-latest")
  include?: string[],         // source globs (default: ["**/*.ts", "**/*.tsx"])
  exclude?: string[],         // exclude globs (default: [])
  extends?: string[],         // paths to parent configs (relative to this file)
  rules: Rule[],              // inline rules (≥1 required)
  rule_files?: string[],      // paths to rule files (single object or array)
  overrides?: Override[],     // per-file severity overrides
}
```

Unknown fields at every level are rejected (strict mode).

## Rule

```typescript
{
  id: string,                       // [a-zA-Z0-9._-]+, non-empty
  where: Selector,                   // which AST nodes this rule targets
  context?: "target" | "enclosing" | "file",  // default: "enclosing"
  question: Question,                // what to ask Jev
  diagnostics: DiagnosticPolicy[],   // ≥1 entry, each maps a Jev answer to a finding
}
```

## Selector

All fields optional except `kind`. ANDed together; undefined = wildcard.

| Field          | Type                                   | Purpose                                                                           |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `kind`         | `string`                               | AST node kind: `function`, `class`, `interface`, `type`, `enum`, `module`, `file` |
| `has_body`     | `boolean`                              | Only meaningful for `kind: "function"`                                            |
| `has_name`     | `boolean`                              | Filter named vs anonymous nodes                                                   |
| `name`         | `string`                               | Exact-match node name                                                             |
| `name_pattern` | `string`                               | Regex tested against node name                                                    |
| `visibility`   | `"public" \| "private" \| "protected"` | TS access modifier                                                                |
| `files`        | `string[]`                             | Glob patterns — match ANY                                                         |
| `exclude`      | `string[]`                             | Glob patterns — exclude if match ANY                                              |

## Question

```typescript
{
  type: "choice",                    // v1: only Choice is supported
  instructions: string | StructuredInstructions,
  criteria: Record<string, Criterion>,  // 2..255 entries, non-empty keys
}
```

### Instructions

Accepts either:

```typescript
// Plain string
instructions: "Is this function simple?"

// Structured object
instructions: {
  question: string,                  // the actual prompt (required)
  focus?: string,                    // what NOT to confuse the question with
  inspect?: string,                  // which state fields to read first
}
```

The structured form is recommended when your question needs boundaries (the `focus`
clause is the single most influential field) or when you want to point Jev at specific
state fields.

### Criteria

```typescript
// Plain string — fine for short self-explanatory rules
criteria: {
  simple: "Each line carries its weight.",
}

// Structured object — for rules that need boundary cases or concrete examples
criteria: {
  needlessly_complex: {
    what: string,                    // what this choice means (required)
    not_for?: string,                // boundary cases that should NOT match
    examples?: string[],             // concrete cases that should match
  },
}

// Mixed in one object
criteria: {
  simple: "Each line carries its weight.",
  needlessly_complex: { what: "...", examples: ["..."] },
  insufficient_context: { what: "..." },
}
```

The Jev HTTP wire shape is always flat strings — structured forms are flattened at
the request boundary. The model sees the same thing either way.

## DiagnosticPolicy

```typescript
{
  when: Condition,                   // when this diagnostic fires
  level: "warn" | "error",
  message: string,                   // template; {name} substitutes the matched AST node name
}
```

First policy whose `when` matches wins; later policies are skipped. The `{name}`
placeholder is the only one currently populated; the matched `choice` and `confidence`
are surfaced in JSON output rather than substituted into the message.

## Condition

All leaf fields ANDed together; `any` is OR; `all` is AND. Recursive.

```typescript
{
  choice?: string,                   // exact match against the Jev answer
  min_confidence?: number,           // 0..1, inclusive
  max_confidence?: number,           // 0..1, must be ≥ min_confidence when both set
  probability?: {                    // bounds on a specific choice's probability
    choice: string,
    min?: number,
    max?: number,
  },
  all?: Condition[],                 // ANDed
  any?: Condition[],                 // OR'd
}
```

## Override

```typescript
{
  files: string[],                   // required, non-empty
  exclude?: string[],                // default: []
  rules: Record<string, "off" | "warn" | "error">,
}
```

Later overrides win over earlier ones. `off` suppresses the rule entirely for matching
files; `warn`/`error` force that severity on the rule's diagnostic. Unknown rule IDs in
the `rules` map are rejected.

## `$schema`

The repo's `ts-semantic-lint --schema config` command prints the full JSON Schema to
stdout. Pipe it into a file:

```bash
ts-semantic-lint --schema config > erislint.schema.json
ts-semantic-lint --schema rule > erislint-rule.schema.json
```

Then reference either from your config:

```json
{
  "$schema": "./erislint.schema.json",
  ...
}
```

## What goes wrong (validation errors you might hit)

| Error                                         | Cause                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `unknown choice "X"`                          | A `diagnostics.when.choice` or `probability.choice` not in the question's criteria |
| `has_body is only valid for function targets` | `where.has_body: true` on a non-function rule                                      |
| `min_confidence exceeds max_confidence`       | Inverted confidence bounds in a condition                                          |
| `probability needs min or max`                | A `probability` entry with neither bound                                           |
| `rule needs at least one diagnostic policy`   | `diagnostics: []`                                                                  |
| `override refers to unknown rule "X"`         | Override references a rule not in `rules`                                          |
| `duplicate rule "X" in /path/to/config.json`  | Same `id` appears twice in one config                                              |
| `extends cycle at /path/to/config.json`       | Circular `extends` chain                                                           |
| `configuration inheritance exceeds 64 levels` | `extends` chain too deep (max 64)                                                  |

## See also

- [README](../README.md) — worked examples for the three bundled rules
- [`docs/conventions.md`](./conventions.md) — module boundaries and engineering conventions (for contributors)
