/**
 * `evaluateRule` — produce the first matching diagnostic for a rule/target/answer.
 *
 * Walks `rule.diagnostics` in order. For each `policy`:
 *   1. If `overrideSetting === "off"`, return `null` (target suppressed).
 *   2. If `condition.matches(answer)` returns `false`, skip this policy.
 *   3. Resolve the effective severity via `resolveSeverity(policy.level, overrideSetting)`.
 *      A severity of `"off"` here means the override flipped an otherwise-active
 *      policy off — return `null` (this is defensive; the brief says upstream
 *      handles the case but we keep the check so the function is total).
 *   4. Otherwise build the `Diagnostic` and return it immediately — first match
 *      wins (matches the Rust original).
 *
 * If no policy matches, return `null`.
 *
 * Note: `selector` matching is the *caller's* responsibility — the runner has
 * already filtered targets by `selector` before calling us. `evaluateRule` only
 * decides which (if any) `diagnostic` to emit for an already-selected target.
 */
import type { Diagnostic, JevAnswer, LintedTarget } from "../types.js";
import type { OverrideSetting, Rule } from "./types.js";
import { matches } from "./condition.js";
import { formatMessage } from "./message.js";
import { resolveSeverity } from "./severity.js";

export function evaluateRule(
  rule: Rule,
  target: LintedTarget,
  answer: JevAnswer,
  overrideSetting: OverrideSetting,
): Diagnostic | null {
  if (overrideSetting === "off") return null;

  for (const policy of rule.diagnostics) {
    if (!matches(policy.when, answer)) continue;

    const level = resolveSeverity(policy.level, overrideSetting);
    if (level === "off") return null;

    const message = formatMessage(
      policy.message ?? `Rule ${rule.id} matched.`,
      target,
    );

    const diagnostic: Diagnostic = {
      ruleId: rule.id,
      level,
      file: target.file,
      range: target.range,
      snippet: target.snippet,
      message,
      confidence: answer.confidence,
      choice: answer.choice,
      answer,
    };
    return diagnostic;
  }

  return null;
}
