/**
 * Severity resolution — combine a policy's intrinsic level with an optional
 * override.
 *
 * Rules (mirrors the brief and the Rust original):
 *
 * - `override === "off"`      → caller must skip the target entirely; we
 *                              return `"off"` to signal this.
 * - `override === "error"`    → force `"error"`, even if the policy said `"warn"`.
 * - `override === "warn"`     → keep the policy's intrinsic level (note: this is
 *                              NOT a downgrade of an `"error"` policy — `"warn"`
 *                              is the *minimum* floor, not a ceiling).
 * - `override === undefined`  → use the policy's intrinsic level.
 *
 * The semantic difference between "policy.level" and "override" is important:
 * `policy.level` is what the rule author asked for; `override` is the user's
 * configuration change on top of that. They are NOT the same axis.
 */
import type { Severity } from "../types.js";

export function resolveSeverity(
  policyLevel: Severity,
  override: Severity | undefined,
): Severity {
  if (override === "off") return "off";
  if (override === "error") return "error";
  // override === "warn" or undefined → keep policyLevel
  return policyLevel;
}
