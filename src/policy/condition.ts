/**
 * Condition matching — does this `Condition` accept this `JevAnswer`?
 *
 * Behavioral contract (mirrors `policy.rs::matches_condition`):
 *
 * - `choice`: exact equality with `answer.choice`.
 * - `min_confidence`: `answer.confidence >= min`.
 * - `max_confidence`: `answer.confidence <= max`.
 * - When both confidence bounds are present, they must be ordered (`min <= max`)
 *   — otherwise no answer can ever satisfy the condition, so we return `false`
 *   immediately (fail-closed) rather than silently accepting a contradictory
 *   spec.
 * - `probability`: bounds on `answer.probabilities[choice]`. Missing probability
 *   for the named choice → no match.
 * - `all`: every nested condition must match.
 * - `any`: at least one nested condition must match.
 *
 * Composition: a leaf condition (no `all` / `any`) ANDs all of its scalar
 * fields. A compound condition (has `all` or `any`) ignores the scalar fields
 * on that same node and recurses — this matches the Rust original where
 * `Condition::All([...])` is a separate variant.
 *
 * Multiple `all` + `any` on the same node is undefined behavior in the spec;
 * we treat it as an error and return `false` (fail-closed) rather than picking
 * a winner.
 */
import type { JevAnswer } from "../types.js";
import type { Condition } from "./types.js";

/** Number of scalar "leaf" fields set on a Condition. */
function leafFieldCount(c: Condition): number {
  let n = 0;
  if (c.choice !== undefined) n += 1;
  if (c.min_confidence !== undefined) n += 1;
  if (c.max_confidence !== undefined) n += 1;
  if (c.probability !== undefined) n += 1;
  return n;
}

export function matches(condition: Condition, answer: JevAnswer): boolean {
  const isCompound = condition.all !== undefined || condition.any !== undefined;
  const isLeaf = leafFieldCount(condition) > 0;

  if (isCompound && isLeaf) {
    // Undefined per the spec: a node cannot both AND scalar fields and have
    // structural composition. Fail closed.
    return false;
  }

  if (condition.all !== undefined) {
    return condition.all.every((c) => matches(c, answer));
  }
  if (condition.any !== undefined) {
    return condition.any.some((c) => matches(c, answer));
  }

  // Leaf path: AND together whichever scalar fields are present.
  if (condition.choice !== undefined && condition.choice !== answer.choice) {
    return false;
  }
  if (
    condition.min_confidence !== undefined &&
    answer.confidence < condition.min_confidence
  ) {
    return false;
  }
  if (
    condition.max_confidence !== undefined &&
    answer.confidence > condition.max_confidence
  ) {
    return false;
  }
  if (
    condition.min_confidence !== undefined &&
    condition.max_confidence !== undefined &&
    condition.min_confidence > condition.max_confidence
  ) {
    // Contradictory bounds — no answer can satisfy.
    return false;
  }
  if (condition.probability !== undefined) {
    const { choice, min, max } = condition.probability;
    const p = answer.probabilities[choice];
    if (p === undefined) return false;
    if (min !== undefined && p < min) return false;
    if (max !== undefined && p > max) return false;
    if (min !== undefined && max !== undefined && min > max) return false;
  }
  return true;
}
