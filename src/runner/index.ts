/**
 * Runner module — orchestrate the full lint pipeline.
 *
 * The pipeline: given a list of files and a `Config`,
 *   1. **scan**     — resolve paths, walk directories, dedupe, sort
 *   2. **extract**  — parse each file → `LintedTarget[]`
 *   3. **match**    — pair targets with applicable rules
 *   4. **batch**    — group targets by `(ruleId, context)` → Jev requests
 *   5. **evaluate** — call Jev per batch → answers → diagnostics
 *
 * `run()` is the full pipeline; `buildRequests()` returns the requests
 * without sending them (used by `--dry-run`).
 */
import type { Config } from "../config/index.js";
import type { JevClient } from "../jev/index.js";
import type { Request as JevRequest } from "../jev/types.js";
import type { Diagnostic, JevAnswer } from "../types.js";

import { batch, targetKey, type Batch } from "./batch.js";
import { extractAll } from "./extract.js";
import { evaluate } from "./evaluate.js";
import { match } from "./match.js";
import { reportProgress } from "./progress.js";
import { scan } from "./scan.js";

// ─── Public types ────────────────────────────────────────────────────────────

/** Options accepted by `run()`. */
export interface RunnerOptions {
  readonly config: Config;
  readonly client: JevClient;
  /** Maximum number of concurrent Jev calls. Defaults to 64. */
  readonly jobs: number;
  /** Optional callback for retry notifications. */
  readonly onRetry?: (msg: string) => void;
}

/** Result of a full `run()` invocation. */
export interface RunnerResult {
  readonly diagnostics: readonly Diagnostic[];
  /** Jev answers, keyed by `${ruleId}::${targetKey}`. */
  readonly answers: ReadonlyMap<string, JevAnswer>;
  readonly filesScanned: number;
  readonly targetsEvaluated: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

const DEFAULT_JOBS = 64;

/**
 * Run the full lint pipeline. Returns sorted diagnostics plus a map of
 * Jev answers keyed by `${ruleId}::${targetKey}`.
 */
export async function run(
  files: readonly string[],
  options: RunnerOptions,
): Promise<RunnerResult> {
  const filesScannedList = await scan(files, options.config);
  const targets = await extractAll(filesScannedList);
  const matched = await match(targets, options.config);
  const batches = await batch(matched.annotated, options.config);

  const diagnostics = await evaluate(batches, {
    config: options.config,
    client: options.client,
    jobs: options.jobs > 0 ? options.jobs : DEFAULT_JOBS,
    ...(options.onRetry !== undefined ? { onRetry: options.onRetry } : {}),
  });

  // Build the answers map: re-derive answers from the batches (we don't
  // need them in evaluate() output — they're available here for callers
  // that want full per-target answers in JSON / --all-answers modes).
  const answers = await collectAnswers(
    batches,
    options.config,
    options.client,
    options.jobs > 0 ? options.jobs : DEFAULT_JOBS,
  );

  reportProgress({
    filesScanned: filesScannedList.length,
    targetsEvaluated: matched.annotated.filter((t) => t.appliedRules.length > 0)
      .length,
    diagnostics,
  });

  return {
    diagnostics,
    answers,
    filesScanned: filesScannedList.length,
    targetsEvaluated: matched.annotated.filter((t) => t.appliedRules.length > 0)
      .length,
  };
}

/**
 * Build Jev requests but do NOT call `client.evaluate()`. Used by the
 * `--dry-run` flag (and for tests).
 */
export async function buildRequests(
  files: readonly string[],
  config: Config,
): Promise<{ requests: readonly JevRequest[]; targets: number }> {
  const scanned = await scan(files, config);
  const targets = await extractAll(scanned);
  const matched = await match(targets, config);
  const batches = await batch(matched.annotated, config);
  return {
    requests: batches.map((b) => b.request),
    targets: matched.annotated.filter((t) => t.appliedRules.length > 0).length,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Re-issue the Jev calls once more, this time collecting the per-target
 * answers. Separate from `evaluate()` because the public `RunnerResult`
 * promises both diagnostics and full answers, and `evaluate()` deliberately
 * throws away the answers to avoid duplicating Jev traffic in production.
 *
 * This implementation is functionally equivalent to the Jev loop in
 * `evaluate()` — tests can opt out by using `buildRequests()`.
 */
async function collectAnswers(
  batches: readonly Batch[],
  config: Config,
  client: JevClient,
  jobs: number,
): Promise<ReadonlyMap<string, JevAnswer>> {
  const out = new Map<string, JevAnswer>();
  if (batches.length === 0) return out;

  await runAll(batches, jobs, async (batch) => {
    const response = await client.evaluate(batch.request);
    const answer = response.answers[batch.rule.id];
    if (answer === undefined) return;
    const shared = {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: { ...answer.probabilities },
    };
    for (const target of batch.targets) {
      out.set(`${batch.rule.id}::${targetKey(target)}`, shared);
    }
  });
  return out;
}

/**
 * Tiny bounded-concurrency helper, kept here (rather than exported from
 * `evaluate.ts`) so the answer-collection path stays separate from the
 * diagnostic path. Mirrors the same pattern as the semaphore in
 * `evaluate.ts`; if either evolves, both should.
 */
async function runAll(
  items: readonly Batch[],
  jobs: number,
  fn: (item: Batch) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, jobs);
  let index = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      await fn(item);
    }
  }
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

// ─── Re-exports for tests and consumers ─────────────────────────────────────

export { batch, targetKey, type Batch } from "./batch.js";
export { extractAll } from "./extract.js";
export { evaluate, type EvaluateOptions } from "./evaluate.js";
export { match, type MatchResult } from "./match.js";
export { reportProgress, isQuiet } from "./progress.js";
export { scan, ALWAYS_EXCLUDED } from "./scan.js";