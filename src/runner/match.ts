/**
 * `match` — for every target, decide which rules apply, group the surviving
 * pairs by `(ruleId, context)`, and annotate each target with its
 * `appliedRules` list.
 *
 * This is the bridge between the config-shape rules (with `where`/`question`/
 * `context`) and the policy-shape rules (with `selector`/`diagnostics`):
 * selector matching is in `policy/selector.ts`; here we consume it via the
 * same logic, then bucket the results for batching.
 */
import ignore from "ignore";
import * as path from "node:path";

import type { Config } from "../config/index.js";
import {
  AST_KINDS_BY_INTERNAL,
  type InternalKind,
} from "../analyzer/kinds.js";
import type {
  AppliedRule,
  LintedTarget,
  RuleContext,
} from "../types.js";

import type { RuleInput } from "../config/schemas.js";

// ─── Kind matching ──────────────────────────────────────────────────────────

/**
 * Pre-computed equivalence map from every accepted `where.kind` value to
 * the internal kind strings that count as a match. Built lazily on first
 * call to avoid a global eager construction cost.
 *
 * - Internal kinds map to themselves (e.g. `"function"` → `"function"`).
 * - PascalCase AST kinds map to the corresponding internal kind (e.g.
 *   `"FunctionDeclaration"` → `"function"`).
 */
const KIND_EQUIV: Readonly<Record<string, readonly string[]>> = buildKindEquiv();

function buildKindEquiv(): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, string[]> = {};
  // Internal kinds map to themselves.
  for (const internal of Object.keys(AST_KINDS_BY_INTERNAL) as InternalKind[]) {
    out[internal] = [internal];
  }
  // PascalCase AST kinds map to their internal kind.
  for (const [internal, astKinds] of Object.entries(AST_KINDS_BY_INTERNAL)) {
    for (const ast of astKinds) {
      if (out[ast] === undefined) {
        out[ast] = [internal];
      } else if (!out[ast].includes(internal)) {
        out[ast].push(internal);
      }
    }
  }
  return Object.freeze(out);
}

/**
 * Test whether `ruleWhereKind` matches `targetKind` (the internal kind).
 * Returns `true` when the rule's `where.kind` is equivalent to one of the
 * kinds a target can carry.
 */
function kindMatches(ruleWhereKind: string, targetKind: string): boolean {
  const candidates = KIND_EQUIV[ruleWhereKind];
  if (candidates === undefined) return false;
  return candidates.includes(targetKind);
}

// ─── File-glob matching for rule-level filter ───────────────────────────────

type IgnoreFactory = (options?: object) => IgnoreInstance;
interface IgnoreInstance {
  add(patterns: string | readonly string[]): IgnoreInstance;
  ignores(pathname: string): boolean;
}
const makeIgnore: IgnoreFactory = (ignore as unknown as IgnoreFactory).bind(ignore) as IgnoreFactory;

function toTestablePath(absolutePath: string): string {
  return path.isAbsolute(absolutePath)
    ? absolutePath.replace(/^\/+/, "")
    : absolutePath;
}

/**
 * Run rule-level `where.files`/`exclude` against `target.file`. Mirrors the
 * per-rule `filter` already compiled in `CompiledRule.filter`, but applies
 * the same gitignore-style matching synchronously (no glob expansion) so
 * the match stays cheap.
 */
function ruleFileMatches(
  absoluteFilePath: string,
  files: readonly string[],
  exclude: readonly string[],
): boolean {
  const rel = toTestablePath(absoluteFilePath);
  if (files.length > 0) {
    const tester = makeIgnore().add(files as string[]);
    if (!tester.ignores(rel)) return false;
  }
  if (exclude.length > 0) {
    const tester = makeIgnore().add(exclude as string[]);
    if (tester.ignores(rel)) return false;
  }
  return true;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * The output of `match`. The per-rule map is keyed by rule id and gives
 * the (immutable) subset of input targets that selected that rule. The
 * per-target list is the new `appliedRules` annotation.
 */
export interface MatchResult {
  /** Targets per rule (keyed by rule id). */
  readonly byRule: ReadonlyMap<string, readonly LintedTarget[]>;
  /**
   * Targets with their `appliedRules` populated. Order matches the input
   * order; multiple rules per target are returned in declaration order.
   */
  readonly annotated: readonly LintedTarget[];
}

/**
 * Run selector matching over `targets` against every rule in `config`.
 *
 * Returns the matched targets per rule plus the annotated target objects.
 * The annotated objects are the canonical record — `byRule` is derived
 * from `annotated.appliedRules`.
 */
export async function match(
  targets: readonly LintedTarget[],
  config: Config,
): Promise<MatchResult> {
  // Per-target: accumulate matching rules in declaration order.
  const appliedByTarget: AppliedRule[][] = targets.map(() => []);
  // Per-rule: collected target references.
  const byRule = new Map<string, LintedTarget[]>();

  let ruleIndex = 0;
  for (const [, compiled] of config.rules) {
    const rule: RuleInput = compiled.definition;
    const ruleId = rule.id;
    const context: RuleContext = rule.context ?? "enclosing";

    ruleIndex++;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (target === undefined) continue;

      // 1. Kind + has_body match.
      if (!kindMatches(rule.where.kind, target.kind)) continue;
      if (
        rule.where.has_body !== undefined &&
        rule.where.has_body !== readHasBody(target)
      ) {
        continue;
      }

      // 2. Project-level file filter.
      if (!(await config.filter.matches(target.file, config.root))) continue;

      // 3. Rule-level file filter (where.files / where.exclude).
      if (
        !ruleFileMatches(
          target.file,
          rule.where.files,
          rule.where.exclude,
        )
      ) {
        continue;
      }

      // 4. Override = "off" → skip this rule for this target.
      if ((await config.settingFor(target.file, ruleId)) === "off") continue;

      // Accept.
      const slot = appliedByTarget[i];
      if (slot === undefined) continue;
      slot.push({ ruleId, context });
      let list = byRule.get(ruleId);
      if (list === undefined) {
        list = [];
        byRule.set(ruleId, list);
      }
      list.push(target);
    }
  }

  // Build the annotated `LintedTarget` list. We use the spread form
  // (rather than mutation) so `LintedTarget` stays immutable from the
  // caller's perspective; the per-target `appliedRules` is a new array.
  const annotated: LintedTarget[] = targets.map((target, i) => {
    const applied = appliedByTarget[i] ?? [];
    if (applied.length === 0) return target;
    return { ...target, appliedRules: applied };
  });

  // Freeze per-rule buckets as readonly arrays.
  const frozenByRule = new Map<string, readonly LintedTarget[]>();
  for (const [id, list] of byRule) {
    frozenByRule.set(id, Object.freeze([...list]));
  }

  // Silence unused-variable warning on `ruleIndex` — kept for future
  // diagnostics without re-introducing a side effect.
  void ruleIndex;

  return {
    byRule: frozenByRule,
    annotated: Object.freeze(annotated),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * `LintedTarget` does not declare `hasBody` — the analyzer attaches it via
 * a custom property. Read defensively, defaulting to `false` when absent
 * (matches the policy module's behavior).
 */
function readHasBody(target: LintedTarget): boolean {
  const candidate = target as unknown as { hasBody?: boolean };
  return candidate.hasBody === true;
}