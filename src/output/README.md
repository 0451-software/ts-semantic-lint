# `output` — diagnostic renderers

Renders `Diagnostic[]` to text (Rust-style, with carets) or JSON.
Compact format is deferred.

## API

```ts
import { render } from "./output/index.js";
import type { Diagnostic } from "./types.js";

const diagnostics: Diagnostic[] = [/* ... */];

// Text — Rust-style blocks with ANSI color when stdout is a TTY.
const text = render(diagnostics, { format: "text", color: "auto" });
process.stdout.write(text.stdout);

// JSON — stable, parseable envelope.
const json = render(diagnostics, { format: "json" });
const parsed = JSON.parse(json.stdout);
```

## `RenderOptions`

| Field         | Type                          | Default      | Notes                                    |
|---------------|-------------------------------|--------------|------------------------------------------|
| `format`      | `"text"` \| `"json"`          | —            | `"compact"` deferred.                    |
| `color`       | `"auto"` \| `"always"` \| `"never"` | `"auto"` | `NO_COLOR` honored in `auto`.            |
| `errorsOnly`  | `boolean`                     | `false`      | Drops warns from output, not from counts.|
| `noColor`     | `boolean`                     | `false`      | Legacy; equivalent to `color: "never"`.  |

## `RenderResult`

```ts
interface RenderResult {
  readonly stdout: string;
  readonly summary: { errors: number; warnings: number };
}
```

Counts always reflect the *full* input list, before `errorsOnly`.

## Sort order

`(file asc, line asc, column asc, ruleId asc)`. Both renderers use the
same comparator (`./sort.ts`).

## Files

| File                  | Purpose                                       |
|-----------------------|-----------------------------------------------|
| `index.ts`            | `render()` dispatch                           |
| `text.ts`             | Rust-style text blocks with carets            |
| `json.ts`             | Stable JSON envelope                          |
| `sort.ts`             | `(file, line, col, ruleId)` ordering          |
| `ansi.ts`             | ANSI helpers + `NO_COLOR` handling            |
| `output.test.ts`      | vitest tests                                  |
| `__fixtures__/`       | Sample diagnostics                            |
