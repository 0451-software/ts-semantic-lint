/**
 * Semantic validation that runs on top of Zod's structural parsing.
 *
 * Most cross-field rules (cycle detection, file references, rule-id
 * uniqueness, has_body-only-for-function, condition.choice must exist,
 * etc.) can be expressed as Zod refinements. A few are easier as
 * post-parse passes; those live here.
 *
 * Validation lives in its own module so the rule and condition schemas
 * can be re-used by the JSON-Schema generator without re-running
 * business rules.
 */
import type {
  ConfigFileInput,
  ConditionInput,
  OverrideInput,
  RuleInput,
} from "./schemas.js";
import { ConfigError } from "./filter.js";

/**
 * Verify all override.rule IDs reference real rule IDs. Mirrors the Rust
 * `merged.overrides` check: `ensure!(rules.contains_key(id), "override refers
 * to unknown rule {id:?}")`.
 */
export function validateOverrides(
  rules: ReadonlyMap<string, RuleInput>,
  overrides: readonly OverrideInput[],
  configPath: string,
): void {
  for (const [idx, ov] of overrides.entries()) {
    const ptr = `overrides[${idx}]`;
    if (ov.files.length === 0) {
      throw new ConfigError(
        `${ptr}: overrides require at least one file pattern`,
        configPath,
      );
    }
    for (const id of Object.keys(ov.rules)) {
      if (!rules.has(id)) {
        throw new ConfigError(
          `${ptr}: refers to unknown rule "${id}"`,
          configPath,
        );
      }
    }
  }
}

/**
 * Verify a `has_body` selector option is only present on `function` rules.
 * Zod accepts both shapes independently; the cross-field check needs a
 * post-parse pass.
 */
export function validateHasBodyOnlyForFunction(
  rule: RuleInput,
  rulePath: string,
): void {
  if (rule.where.has_body !== undefined && rule.where.kind !== "function") {
    throw new ConfigError(
      `${rulePath}: has_body is only valid for function targets (rule.kind="${rule.where.kind}")`,
      rulePath,
    );
  }
}

/**
 * Verify every `condition.choice` reference names a real Jev choice.
 * Also checks `condition.probability.choice`. Recursive for `all`/`any`.
 */
export function validateConditionChoiceRefs(
  rule: RuleInput,
  rulePath: string,
): void {
  const criteriaKeys = new Set(Object.keys(rule.question.criteria));
  for (const [di, diag] of rule.diagnostics.entries()) {
    const diagPath = `${rulePath}.diagnostics[${di}]`;
    checkCondition(diag.when, criteriaKeys, `${diagPath}.when`);
  }
}

function checkCondition(
  cond: ConditionInput,
  criteriaKeys: ReadonlySet<string>,
  path: string,
): void {
  if (cond.choice !== undefined && !criteriaKeys.has(cond.choice)) {
    throw new ConfigError(
      `${path}.choice: unknown choice "${cond.choice}"`,
      path,
    );
  }
  if (cond.probability !== undefined) {
    if (!criteriaKeys.has(cond.probability.choice)) {
      throw new ConfigError(
        `${path}.probability.choice: unknown choice "${cond.probability.choice}"`,
        path,
      );
    }
  }
  if (cond.all !== undefined) {
    if (cond.all.length === 0) {
      throw new ConfigError(
        `${path}.all: must contain at least one condition`,
        path,
      );
    }
    cond.all.forEach((c: ConditionInput, i: number) =>
      checkCondition(c, criteriaKeys, `${path}.all[${i}]`),
    );
  }
  if (cond.any !== undefined) {
    if (cond.any.length === 0) {
      throw new ConfigError(
        `${path}.any: must contain at least one condition`,
        path,
      );
    }
    cond.any.forEach((c: ConditionInput, i: number) =>
      checkCondition(c, criteriaKeys, `${path}.any[${i}]`),
    );
  }
}

/**
 * Run all cross-field rule validation. Safe to call once per rule after
 * structural parsing.
 */
export function validateRuleSemantics(
  rule: RuleInput,
  rulePath: string,
): void {
  validateHasBodyOnlyForFunction(rule, rulePath);
  validateConditionChoiceRefs(rule, rulePath);
}

/** Wrapper that validates every rule in a config file. */
export function validateAllRules(
  rules: ReadonlyMap<string, RuleInput>,
  configPath: string,
): void {
  for (const [id, rule] of rules.entries()) {
    validateRuleSemantics(rule, `${configPath}::rules["${id}"]`);
  }
}

/** Re-export the input type so callers don't need to dig into schemas.ts. */
export type { ConfigFileInput };
