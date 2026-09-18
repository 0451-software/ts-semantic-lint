/**
 * Policy-module type contracts.
 *
 * These types are local to the policy module — they extend the shared types
 * in `src/types.ts` (which hold cross-cutting concepts like `LintedTarget`
 * and `Selector`) with policy-specific shapes (`Rule`, `Policy`, `Condition`,
 * `OverrideSetting`).
 *
 * Kept in `src/policy/` (not `src/types.ts`) so the policy module is
 * self-contained during the parallel phase. Other modules are forbidden
 * from importing these — they exist only to express policy internals.
 */
import type {
  Diagnostic,
  DiagnosticLevel,
  JevAnswer,
  Selector,
  Severity,
} from "../types.js";

// ─── Override ────────────────────────────────────────────────────────────────

/**
 * A per-target override from config. `undefined` means "no override".
 * `"off"` suppresses the rule entirely; `"warn"`/`"error"` force that level.
 */
export type OverrideSetting = Severity | undefined;

// ─── Condition ───────────────────────────────────────────────────────────────

/**
 * Probability window — inclusive bounds. Either or both may be omitted.
 */
export interface ProbabilityRange {
  readonly choice: string;
  readonly min?: number;
  readonly max?: number;
}

/**
 * A predicate tree that decides whether a Jev answer qualifies for a
 * diagnostic. All branches are ANDed when composing with `all`; `any` is OR.
 *
 * - `choice`: exact-match `answer.choice`.
 * - `min_confidence` / `max_confidence`: bounds on `answer.confidence`.
 *   When both set, must be ordered (min ≤ max).
 * - `probability`: bounds on `answer.probabilities[choice]`.
 * - `all` / `any`: logical composition (mutually exclusive with leaf fields).
 */
export interface Condition {
  readonly choice?: string;
  readonly min_confidence?: number;
  readonly max_confidence?: number;
  readonly probability?: ProbabilityRange;
  readonly all?: readonly Condition[];
  readonly any?: readonly Condition[];
}

// ─── Policy ──────────────────────────────────────────────────────────────────

/**
 * One diagnostic-producing policy attached to a rule. The first policy whose
 * `when` matches (and that isn't overridden to `"off"`) wins; later policies
 * are skipped.
 */
export interface Policy {
  readonly when: Condition;
  readonly level: Severity;
  readonly message?: string;
}

// ─── Rule ────────────────────────────────────────────────────────────────────

/**
 * A linter rule: a selector that picks targets, plus an ordered list of
 * policies that decide what (if anything) to report.
 */
export interface Rule {
  readonly id: string;
  readonly selector: Selector;
  readonly diagnostics: readonly Policy[];
  readonly defaultLevel?: Severity;
}

// ─── Inputs to evaluateRule ─────────────────────────────────────────────────

/**
 * Everything needed to evaluate one rule against one target/answer pair.
 */
export interface EvaluateInputs {
  readonly rule: Rule;
  readonly target: import("../types.js").LintedTarget;
  readonly answer: JevAnswer;
  readonly overrideSetting: OverrideSetting;
}

export type { Diagnostic, DiagnosticLevel, JevAnswer, Severity };
