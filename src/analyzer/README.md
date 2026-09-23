# Analyzer

AST extraction for ts-semantic-lint — converts TypeScript source files into the
shared `LintedTarget[]` shape consumed by the runner.

This module is the TypeScript port of ErisLint's `src/rust.rs`. Same behavior,
fresh implementation; no source reuse (the original is AGPL-3.0, this rewrite
is MIT).

## API

```ts
import { extractTargets } from "./analyzer/index.js";

const targets = extractTargets(sourceCode, "/abs/path/to/file.ts", {
  // optional:
  kinds: new Set(["function", "class"]),
  fileText: sourceCode,
  parseOptions: { comment: true, loc: true, range: true },
});
```

`extractTargets(source, filePath, options?)` → `LintedTarget[]`

- `source` — UTF-8 source text.
- `filePath` — absolute path; recorded on every target.
- `options.kinds` — restrict to a subset of the default kinds:
  `function`, `class`, `interface`, `type`, `enum`, `module`, `file`.
- `options.fileText` — override the file-level source text (defaults to `source`).
- `options.parseOptions` — forwarded to `typescript-estree`. The default
  enables `comment`, `loc`, and `range`.

Throws `SyntaxError` if `typescript-estree` reports a parse failure. The error
message includes the line and column of the first reported issue.

## Extracted kinds

| AST node                                   | `LintedTarget.kind` |
| ------------------------------------------ | ------------------- |
| `FunctionDeclaration`                      | `function`          |
| `TSDeclareFunction` (`declare function …`) | `function`          |
| `ArrowFunctionExpression`                  | `function`          |
| `MethodDefinition`                         | `function`          |
| `ClassDeclaration` / `ClassExpression`     | `class`             |
| `TSInterfaceDeclaration`                   | `interface`         |
| `TSTypeAliasDeclaration`                   | `type`              |
| `TSEnumDeclaration`                        | `enum`              |
| `TSModuleDeclaration` (`namespace`)        | `module`            |
| `Program` (whole file)                     | `file`              |

For each target we attach a rich `state` field (custom, not part of
`LintedTarget`) containing the parameters, return type, body, modifiers,
heritage, fields, methods, etc. The shape mirrors ErisLint's `state` JSON but
is adapted for TypeScript: it is JSON-serializable and safe to send to Jev.

## Files

- `index.ts` — `extractTargets` entry point + helpers.
- `kinds.ts` — TS AST kind ↔ internal kind mapping.
- `describe.ts` — per-kind `state` JSON construction.
- `enclosing.ts` — ancestor walk for `LintedTarget.enclosing`.
- `positions.ts` — `Lines` struct (byte offset → line/column).
- `analyzer.test.ts` — vitest tests.
- `__fixtures__/` — small TS snippets used by the tests.

## Conventions

- No cross-module imports; only `../types.js` (shared types) and node_modules.
- No `any`. Strict TS with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- JSDoc comments are collected via `attachLeadingComments`, which pairs the
  global `ast.comments` list with the nearest following node. We do not rely
  on `typescript-estree`'s automatic `leadingComments` attachment (it does not
  set them by default).
- Parent pointers are established with `simpleTraverse(..., true)` so
  `ArrowFunctionExpression` and similar nodes can resolve their const-binding
  names.

## Testing

```sh
npx vitest run src/analyzer
```

All tests are colocated in `analyzer.test.ts`. Fixtures live in
`__fixtures__/index.ts`.
