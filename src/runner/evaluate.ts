/**
 * `evaluate` — execute the batched Jev requests, collect answers, run the
 * per-target policy evaluator, and aggregate diagnostics.
 *
 * Concurrency is bounded by `RunnerOptions.jobs` via a small async
 * semaphore (no extra dependencies). Diagnostic results are sorted by
 * `(file, line, column, ruleId)` to match `runner.rs::Report` and the
 * `LintedTarget.range` ordering the brief calls for.
 */
import type { Config } from "../config/index.js";
import type {
  DiagnosticPolicyInput,
  RuleInput,
  RuleSettingInput,
} from "../config/schemas.js";
import type { JevClient } from "../jev/index.js";
import type {
  ChoiceAnswer,
  Response as JevResponse,
} from "../jev/types.js";
import type { OverrideSetting, Rule } from "../policy/types.js";
import { evaluateRule } from "../policy/index.js";
import type { JevAnswer, Diagnostic, LintedTarget } from "../types.js";
import { toSharedAnswer } from "../jev/types.js";

import type { Batch } from "./batch.js";

/** Build the policy-shape `Rule` from the config-shape `RuleInput`. */
function toPolicyRule(rule: RuleInput): Rule {
  // `diagnostics` and `where` are structurally identical between the two
  // shapes (config-side is mutable, policy-side is readonly). The cast
  // is the canonical bridge called out in the brief.
  const policyRule: Rule = {
    id: rule.id,
    selector: rule.where as unknown as Rule["selector"],
    diagnostics: rule.diagnostics.map((p) => toPolicy(p)),
    // defaultLevel is omitted — the policy module does not consume it.
  };
  return policyRule;
}

function toPolicy(p: DiagnosticPolicyInput): Rule["diagnostics"][number] {
  return {
    when: p.when as unknown as Rule["diagnostics"][number]["when"],
    level: p.level,
    message: p.message,
  };
}

/** Convert a config-shaped setting to the policy-shaped `OverrideSetting`. */
function toOverrideSetting(
  setting: RuleSettingInput | undefined,
): OverrideSetting {
  return setting;
}

/**
 * Try to coerce one Jev answer id into a shared `JevAnswer`. Returns
 * `undefined` when the response doesn't carry the expected key (the
 * JevClient should already have validated this; the lookup is defensive).
 */
function answerFor(
  response: JevResponse,
  questionId: string,
): JevAnswer | undefined {
  const answer: ChoiceAnswer | undefined = response.answers[questionId];
  if (answer === undefined) return undefined;
  return toSharedAnswer(answer);
}

/**
 * A simple async semaphore — bounded concurrent execution without
 * pulling in `p-limit` (which is not in our dependency tree).
 *
 * `jobs: 0` means "run all in parallel" (semaphore is wide open).
 */
async function withSemaphore<T>(
  jobs: number,
  items: readonly T[],
  fn: (item: T) => Promise<unknown>,
): Promise<unknown[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, jobs);
  const queue = items.slice();
  const results: unknown[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = index++;
      if (i >= queue.length) return;
      const item = queue[i];
      if (item === undefined) return;
      results[i] = await fn(item);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/** Options for `evaluate` that mirror the runner's public surface. */
export interface EvaluateOptions {
  readonly config: Config;
  readonly client: JevClient;
  readonly jobs: number;
  readonly onRetry?: (msg: string) => void;
}

/**
 * Execute every batch's Jev request, evaluate policies per target, and
 * return sorted diagnostics.
 *
 * Any Jev failure (after retries) propagates up — the brief is explicit
 * that the runner must not silently skip on Jev errors.
 */
export async function evaluate(
  batches: readonly Batch[],
  options: EvaluateOptions,
): Promise<readonly Diagnostic[]> {
  if (batches.length === 0) return Object.freeze([]);

  const results = (await withSemaphore(options.jobs, batches, async (batch) => {
    return runOneBatch(batch, options);
  })) as readonly PerBatchResult[];

  const diagnostics: Diagnostic[] = [];
  for (const result of results) {
    for (const d of result.diagnostics) {
      diagnostics.push(d);
    }
  }

  // Sort by (file, line, column, ruleId) — matches `runner.rs::Report`.
  diagnostics.sort(compareDiagnostic);

  // Forward per-batch retry notifications to the caller's hook.
  if (options.onRetry !== undefined) {
    for (const result of results) {
      if (result.retryMessage !== undefined) {
        options.onRetry(result.retryMessage);
      }
    }
  }

  return Object.freeze(diagnostics);
}

interface PerBatchResult {
  diagnostics: readonly Diagnostic[];
  retryMessage?: string;
}

/**
 * Evaluate one batch. Wraps JevClient.evaluate so a single failure is
 * surfaced with the file / rule context attached.
 */
async function runOneBatch(
  batch: Batch,
  options: EvaluateOptions,
): Promise<PerBatchResult> {
  const { rule, targets: batchTargets } = batch;
  let response: JevResponse;
  try {
    response = await options.client.evaluate(batch.request);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `evaluating ${rule.id} for ${batchTargets.length} target(s) (e.g. ${batchTargets[0]?.file ?? "<unknown>"}): ${detail}`,
    );
  }

  const policyRule = toPolicyRule(rule);
  const answer = answerFor(response, rule.id);
  if (answer === undefined) {
    // JevClient already validated the response shape; this path is for
    // belt-and-braces defense in depth.
    throw new Error(
      `Jev response missing answer for question id "${rule.id}"`,
    );
  }

  const diagnostics: Diagnostic[] = [];
  for (const target of batchTargets) {
    const override = await options.config.settingFor(target.file, rule.id);
    const diag = evaluateRule(
      policyRule,
      target,
      answer,
      toOverrideSetting(override),
    );
    if (diag !== null) {
      diagnostics.push(diag);
    }
  }

  return { diagnostics: Object.freeze(diagnostics) };
}

/**
 * Sort comparator for diagnostics: `(file, line, column, ruleId)`. The
 * line/column source matches what most editors display.
 */
function compareDiagnostic(a: Diagnostic, b: Diagnostic): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.range.start.line !== b.range.start.line) {
    return a.range.start.line - b.range.start.line;
  }
  if (a.range.start.column !== b.range.start.column) {
    return a.range.start.column - b.range.start.column;
  }
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return 0;
}

/** Re-export `LintedTarget` so consumers can import from the runner barrel. */
export type { LintedTarget };