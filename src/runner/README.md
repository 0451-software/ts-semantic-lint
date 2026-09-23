# Runner Module

Orchestrates the full lint pipeline:

```
scan → extract → match → batch → evaluate
```

## Public API

```ts
import { run, buildRequests } from "@/runner/index.js";

const result = await run(files, {
  config,
  client: jevClient,
  jobs: 64,
});

const dry = await buildRequests(files, config);
```

### `run(files, options)`

Full pipeline. Returns `RunnerResult`:

```ts
interface RunnerResult {
  diagnostics: readonly Diagnostic[]; // sorted by (file, line, column, ruleId)
  answers: ReadonlyMap<string, JevAnswer>; // keyed by `${ruleId}::${targetKey}`
  filesScanned: number;
  targetsEvaluated: number;
}
```

`RunnerOptions`:

```ts
interface RunnerOptions {
  config: Config;
  client: JevClient;
  jobs: number; // bounded concurrency (default 64)
  onRetry?: (msg: string) => void;
}
```

### `buildRequests(files, config)`

Build Jev requests without calling `JevClient.evaluate()`. Used by
`--dry-run`. Returns `{ requests, targets }` where `requests` is the
list of Jev requests that _would_ be sent and `targets` is the number
of targets that matched at least one rule.

## Sub-modules

| File          | Role                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `scan.ts`     | Walk + filter file paths. Always excludes `node_modules`, `dist`, `.git`, `coverage`, `target`. |
| `extract.ts`  | Read each file with `fs/promises.readFile` and call `extractTargets`. Throws on syntax error.   |
| `match.ts`    | For each `(target, rule)` decide if the rule applies. Annotates `target.appliedRules`.          |
| `batch.ts`    | Group annotated targets by `(ruleId, context)` → Jev `Request[]`.                               |
| `evaluate.ts` | Run Jev per batch, call `policy.evaluateRule`, sort diagnostics, bubble up errors.              |
| `progress.ts` | stderr progress reporter. Hidden when `TS_SEMANTIC_LINT_QUIET=1`.                               |

## Pipeline flow

1. **scan** — `Config.filter.matches(file)` against each input path;
   directories walked; always-excluded directories pruned.
2. **extract** — `extractTargets(source, file)` per file. Syntax errors
   abort the run before any Jev call.
3. **match** — For each `(target, rule)`:
   - Skip when `rule.where.kind` doesn't match `target.kind`.
   - Skip when project filter rejects `target.file`.
   - Skip when rule-level `where.files` / `where.exclude` rejects it.
   - Skip when `config.settingFor(target.file, rule.id) === "off"`.
   - Otherwise: annotate `target.appliedRules` with `{ ruleId, context }`.
4. **batch** — Group annotated targets by `(ruleId, context)`. One Jev
   request per bucket.
5. **evaluate** — Call `client.evaluate(request)` per batch (bounded by
   `options.jobs`). For each response, run `evaluateRule(rule, target, answer, override)`
   per target. Aggregate + sort diagnostics.

## Diagnostics sort order

Diagnostics are sorted by `(file, line, column, ruleId)`, matching
`runner.rs::Report` and the brief's spec.

## Tests

`runner.test.ts` covers:

- scan filter + always-exclude
- extractAll across files + throws on syntax error
- match: kind filter, override off, appliedRules context
- batch: per-rule grouping
- evaluate: one Jev call per batch, sort order, error propagation
- buildRequests: no Jev calls
- concurrency: bounded `jobs` (counter-based fake client)
