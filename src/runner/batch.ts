/**
 * `batch` — group annotated targets by `(ruleId, context)` and build the
 * Jev `Request` for each bucket.
 *
 * One request per bucket: each request's `state` is a JSON object holding
 * every target's state for that rule+context, and `questions` is a
 * single-entry map keyed by the rule id.
 *
 * The bridge: `RuleInput` (config shape, with `question`/`context`/`where`)
 * is converted to a `Rule` (policy shape, with `selector`/`diagnostics`)
 * lazily by the caller (`evaluate`) — `batch` keeps the rule in its
 * config shape and only consumes the fields it actually needs.
 */
import { z } from "zod";

import type { Config } from "../config/index.js";
import {
  InputContextSchema,
  type RuleInput,
} from "../config/schemas.js";
import {
  toWireQuestion,
  type Question,
  type Request as JevRequest,
} from "../jev/types.js";
import type {
  LintedTarget,
  RuleContext,
} from "../types.js";

/** Per-bucket InputContext — derived from the Zod schema. */
export type InputContext = z.infer<typeof InputContextSchema>;

/** A batched request: rule, context, the targets in the bucket, and the Jev request. */
export interface Batch {
  readonly rule: RuleInput;
  readonly context: InputContext;
  readonly targets: readonly LintedTarget[];
  readonly request: JevRequest;
}

/**
 * Deterministic target key used both for grouping and as the Jev answer id.
 * Matches the Rust original's `${file}:${start_offset}` scheme.
 */
export function targetKey(target: LintedTarget): string {
  return `${target.file}:${target.range.start.offset}`;
}

/**
 * Build the per-target state object that ships inside the Jev request body.
 *
 * The Rust original builds a JSON object with a few canonical fields
 * (name, kind, file, snippet, enclosing, attributes, docs, visibility,
 * generics, where). We follow the same shape — additional fields (e.g.
 * `has_body`, custom analyzer-emitted properties) are preserved by
 * reading `target as Record<string, unknown>` and forwarding unknown keys
 * for forward compatibility.
 */
function targetState(target: LintedTarget): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: target.name,
    kind: target.kind,
    file: target.file,
    snippet: target.snippet,
    enclosing: target.enclosing,
    attributes: target.attributes,
    docs: target.docs,
    visibility: target.visibility,
    range: target.range,
    declarationStart: target.declarationStart,
    generics: target.generics,
    whereClause: target.whereClause,
  };
  // Forward the analyzer's "describe" payload if present.
  const state = (target as unknown as { state?: unknown }).state;
  if (state !== undefined) {
    base["describe"] = state;
  }
  return base;
}

/**
 * Build a Jev request body for one (rule, context) bucket.
 *
 * The `state` is a single JSON object whose keys are target keys and whose
 * values are the per-target state objects. The `questions` map has one
 * entry — keyed by the rule id — because a bucket is a single-rule batch.
 */
function buildRequest(
  model: string,
  rule: RuleInput,
  context: InputContext,
  targets: readonly LintedTarget[],
): JevRequest {
  const state: Record<string, Record<string, unknown>> = {};
  for (const target of targets) {
    state[targetKey(target)] = targetState(target);
  }
  // The config holds the structured form of the question (string | object
  // for `instructions`; string | object for each criterion). The Jev HTTP
  // body requires flat strings, so we flatten at the boundary — leaving
  // the config holding the structured form for clarity and editability.
  // See `toWireQuestion` in `src/jev/types.ts` for the flatten rules.
  const question: Question = toWireQuestion(rule.question);
  const questions: Readonly<Record<string, Question>> = {
    [rule.id]: question,
  };
  return {
    model,
    state,
    questions,
  };
}

/** Convert the runner's `RuleContext` to the config-shaped `InputContext`. */
function toInputContext(ctx: RuleContext): InputContext {
  return ctx;
}

/**
 * Walk the annotated targets and emit one batch per `(ruleId, context)`
 * combination.
 *
 * Targets are grouped in their input order; the resulting batches are
 * returned in declaration order (i.e. the first rule's batches appear
 * before later rules'). Within a rule, batches for different contexts
 * appear in `enclosing → target → file` order.
 */
export async function batch(
  targets: readonly LintedTarget[],
  config: Config,
): Promise<readonly Batch[]> {
  // Map: ruleId → Map: context → target[].
  const buckets = new Map<string, Map<InputContext, LintedTarget[]>>();

  for (const target of targets) {
    if (target.appliedRules.length === 0) continue;
    for (const applied of target.appliedRules) {
      let contexts = buckets.get(applied.ruleId);
      if (contexts === undefined) {
        contexts = new Map<InputContext, LintedTarget[]>();
        buckets.set(applied.ruleId, contexts);
      }
      const ctx = toInputContext(applied.context);
      let list = contexts.get(ctx);
      if (list === undefined) {
        list = [];
        contexts.set(ctx, list);
      }
      list.push(target);
    }
  }

  const out: Batch[] = [];
  for (const [, compiled] of config.rules) {
    const rule = compiled.definition;
    const contexts = buckets.get(rule.id);
    if (contexts === undefined) continue;
    for (const ctx of CONTEXT_ORDER) {
      const targets = contexts.get(ctx);
      if (targets === undefined) continue;
      out.push({
        rule,
        context: ctx,
        targets: Object.freeze([...targets]),
        request: buildRequest(config.model, rule, ctx, targets),
      });
    }
  }
  return Object.freeze(out);
}

/** Stable ordering of `InputContext` values when emitting batches. */
const CONTEXT_ORDER: readonly InputContext[] = Object.freeze([
  "enclosing",
  "target",
  "file",
]);