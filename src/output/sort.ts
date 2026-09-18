/**
 * Stable, deterministic ordering for diagnostics.
 *
 * Sort key: `(file asc, line asc, column asc, ruleId asc)`. Comparisons
 * are case-sensitive for `file` and `ruleId` to match the Rust original;
 * path strings are absolute, so casing differences are usually meaningful.
 *
 * The function never mutates the input — it returns a new array.
 */
import type { Diagnostic } from "../types.js";

export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if (a.file !== b.file) {
    return a.file < b.file ? -1 : 1;
  }
  const aLine = a.range.start.line;
  const bLine = b.range.start.line;
  if (aLine !== bLine) {
    return aLine - bLine;
  }
  const aCol = a.range.start.column;
  const bCol = b.range.start.column;
  if (aCol !== bCol) {
    return aCol - bCol;
  }
  if (a.ruleId !== b.ruleId) {
    return a.ruleId < b.ruleId ? -1 : 1;
  }
  return 0;
}

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareDiagnostics);
}
