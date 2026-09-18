/**
 * Sample fixtures for the output module's tests.
 *
 * These are hand-rolled rather than read from disk so the tests stay
 * hermetic — no fixtures directory to create, no path joins to debug.
 * Every `Diagnostic` here matches the shape from `src/types.ts`.
 */
import type { Diagnostic, JevAnswer } from "../../types.js";

const ANSWER_NEEDLESSLY_COMPLEX: JevAnswer = {
  choice: "needlessly_complex",
  confidence: 0.78,
  probabilities: {
    simple: 0.15,
    needlessly_complex: 0.78,
    trivial: 0.07,
  },
  model: "test-model",
  rubric: "rubric-1",
};

function makeRange(startLine: number, startCol: number, endLine: number, endCol: number) {
  return {
    start: { line: startLine, column: startCol, offset: 0 },
    end: { line: endLine, column: endCol, offset: 0 },
  };
}

/** File A: a simple `add` function — used in the Rust-style example. */
export const FILE_A = "/abs/a.ts";
export const FILE_B = "/abs/b.ts";

/** Diagnostic targeting `add` in FILE_A — warning, with full Jev answer. */
export const DIAG_ADD: Diagnostic = {
  ruleId: "function-simplicity",
  level: "warn",
  file: FILE_A,
  range: makeRange(1, 17, 3, 2),
  snippet: "export function add(a: number, b: number): number {\n  return a + b;\n}",
  message: "Consider whether add can express its work more directly.",
  confidence: 0.78,
  choice: "needlessly_complex",
  answer: ANSWER_NEEDLESSLY_COMPLEX,
};

/** An error-level diagnostic in FILE_B, no answer attached. */
export const DIAG_ERROR_B: Diagnostic = {
  ruleId: "unused-export",
  level: "error",
  file: FILE_B,
  range: makeRange(2, 14, 2, 20),
  snippet: "export const unused = 42;",
  message: "Export `unused` is never used.",
};

/** A second warning in FILE_A, later line — for sort coverage. */
export const DIAG_OTHER_A: Diagnostic = {
  ruleId: "type-naming",
  level: "warn",
  file: FILE_A,
  range: makeRange(10, 6, 10, 13),
  snippet: "type user_id = string;",
  message: "Type `user_id` should use upper-case.",
  confidence: 0.62,
};

/**
 * The canonical fixture list used by the JSON / text tests. Order is
 * deliberately shuffled so the renderer is forced to sort.
 */
export const ALL_DIAGNOSTICS: readonly Diagnostic[] = [
  DIAG_OTHER_A,
  DIAG_ERROR_B,
  DIAG_ADD,
];

/**
 * Plain (no-color) text block expected for `ALL_DIAGNOSTICS`, after
 * sorting by (file, line, column, ruleId).
 *
 * Sort order: all `/abs/a.ts` diagnostics (by line) come first, then
 * `/abs/b.ts`.
 *
 * Layout: one block per diagnostic, separated by blank lines.
 *   - `warning[function-simplicity]: …` (line 1 in a.ts, col 17 → `add`)
 *   - `warning[type-naming]: …` (line 10 in a.ts, col 6 → `user_id`)
 *   - `error[unused-export]: …` (line 2 in b.ts, col 14 → `unused`)
 */
export const EXPECTED_PLAIN_TEXT = [
  "warning[function-simplicity]: Consider whether add can express its work more directly.",
  " --> /abs/a.ts:1:17",
  "|",
  "  1 | export function add(a: number, b: number): number {",
  "   |                 ^^^",
  "  2 |   return a + b;",
  "  3 | }",
  "",
  "warning[type-naming]: Type `user_id` should use upper-case.",
  " --> /abs/a.ts:10:6",
  "|",
  " 10 | type user_id = string;",
  "   |      ^^^^^^^",
  "",
  "error[unused-export]: Export `unused` is never used.",
  " --> /abs/b.ts:2:14",
  "|",
  "  2 | export const unused = 42;",
  "   |              ^^^^^^",
].join("\n");
