/**
 * Tests for the output module.
 *
 * Covers the 10 cases in the brief:
 *
 *   1. Sort by (file, line, column, ruleId)
 *   2. Text mode produces Rust-style blocks with carets
 *   3. Text mode emits one block per diagnostic
 *   4. JSON output includes `diagnostics` and `summary`
 *   5. JSON output is JSON.parse-able
 *   6. Color: auto / always / never
 *   7. NO_COLOR env var disables color in auto mode
 *   8. errorsOnly drops warnings; counts hidden warnings in summary
 *   9. Empty diagnostics list renders "No issues found." for text
 *  10. JSON empty list has summary {errors:0,warnings:0} and diagnostics:[]
 */
import { describe, expect, it } from "vitest";

import { colorEnabled } from "./ansi.js";
import { render } from "./index.js";
import { buildJson, renderJson, summarize } from "./json.js";
import { compareDiagnostics, sortDiagnostics } from "./sort.js";
import { renderText } from "./text.js";

import {
  ALL_DIAGNOSTICS,
  DIAG_ADD,
  DIAG_ERROR_B,
  DIAG_OTHER_A,
  EXPECTED_PLAIN_TEXT,
  FILE_A,
  FILE_B,
} from "./__fixtures__/diagnostics.js";

describe("sortDiagnostics", () => {
  it("sorts by (file asc, line asc, column asc, ruleId asc)", () => {
    const sorted = sortDiagnostics(ALL_DIAGNOSTICS);
    expect(
      sorted.map(
        (d) =>
          `${d.file}:${d.range.start.line}:${d.range.start.column}:${d.ruleId}`,
      ),
    ).toEqual([
      `${FILE_A}:1:17:function-simplicity`,
      `${FILE_A}:10:6:type-naming`,
      `${FILE_B}:2:14:unused-export`,
    ]);
  });

  it("compareDiagnostics returns 0 for identical diagnostics", () => {
    expect(compareDiagnostics(DIAG_ADD, DIAG_ADD)).toBe(0);
  });

  it("does not mutate the input array", () => {
    const original = [...ALL_DIAGNOSTICS];
    sortDiagnostics(ALL_DIAGNOSTICS);
    expect(ALL_DIAGNOSTICS).toEqual(original);
  });
});

describe("renderText", () => {
  it("produces Rust-style blocks with carets when color is disabled", () => {
    const out = renderText(ALL_DIAGNOSTICS, { color: false });
    expect(out).toBe(EXPECTED_PLAIN_TEXT);
  });

  it("emits one block per diagnostic, separated by blank lines", () => {
    const out = renderText(ALL_DIAGNOSTICS, { color: false });
    // Each diagnostic contributes a multi-line block followed by a blank line.
    // Joining 3 blocks with "\n\n" produces exactly two "\n\n" separators.
    const blankLineCount = (out.match(/\n\n/g) ?? []).length;
    expect(blankLineCount).toBe(2);
    // Header lines (one per diagnostic) appear once each.
    expect(out.match(/^warning\[/gm)?.length).toBe(2);
    expect(out.match(/^error\[/gm)?.length).toBe(1);
  });

  it("emits ANSI escape sequences when color is enabled", () => {
    const out = renderText(ALL_DIAGNOSTICS, { color: true });
    expect(out).toContain("\x1b[");
    // Header word must be colorized, but the brackets / message remain plain.
    expect(out).toContain("\x1b[1;33mwarning\x1b[0m");
    expect(out).toContain("\x1b[1;31merror\x1b[0m");
  });
});

describe("renderJson / buildJson / summarize", () => {
  it("JSON output includes `diagnostics` and `summary`", () => {
    const parsed = buildJson(ALL_DIAGNOSTICS);
    expect(parsed).toHaveProperty("diagnostics");
    expect(parsed).toHaveProperty("summary");
    expect(parsed.summary).toEqual({ errors: 1, warnings: 2 });
    expect(parsed.diagnostics).toHaveLength(3);
  });

  it("JSON output is JSON.parse-able", () => {
    const text = renderJson(ALL_DIAGNOSTICS);
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text) as {
      summary: { errors: number; warnings: number };
      diagnostics: unknown[];
    };
    expect(parsed.diagnostics).toHaveLength(3);
    expect(parsed.summary.errors).toBe(1);
    expect(parsed.summary.warnings).toBe(2);
  });

  it("JSON output includes the full `answer` block when present", () => {
    const parsed = buildJson([DIAG_ADD]);
    const first = parsed.diagnostics[0];
    if (!first) throw new Error("expected one diagnostic");
    expect(first.answer?.choice).toBe("needlessly_complex");
    expect(first.answer?.probabilities.needlessly_complex).toBeCloseTo(0.78);
  });

  it("summarize counts errors and warnings separately", () => {
    expect(summarize(ALL_DIAGNOSTICS)).toEqual({ errors: 1, warnings: 2 });
    expect(summarize([])).toEqual({ errors: 0, warnings: 0 });
    expect(summarize([DIAG_ERROR_B, DIAG_ERROR_B])).toEqual({
      errors: 2,
      warnings: 0,
    });
  });
});

describe("colorEnabled", () => {
  it("always forces color", () => {
    expect(colorEnabled("always", false, "1")).toBe(true);
    expect(colorEnabled("always", false, undefined)).toBe(true);
  });

  it("never disables color", () => {
    expect(colorEnabled("never", true, undefined)).toBe(false);
    expect(colorEnabled("never", true, undefined)).toBe(false);
  });

  it("auto requires TTY and unset NO_COLOR", () => {
    expect(colorEnabled("auto", true, undefined)).toBe(true);
    expect(colorEnabled("auto", false, undefined)).toBe(false);
    expect(colorEnabled("auto", true, "")).toBe(true); // empty string is "not set"
  });

  it("auto is disabled when NO_COLOR is set to any non-empty value", () => {
    expect(colorEnabled("auto", true, "1")).toBe(false);
    expect(colorEnabled("auto", true, "true")).toBe(false);
    expect(colorEnabled("auto", true, "yes")).toBe(false);
  });
});

describe("render — integration", () => {
  it("text mode with default options returns Rust-style output", () => {
    const result = render(ALL_DIAGNOSTICS, { format: "text", color: "never" });
    expect(result.stdout).toBe(EXPECTED_PLAIN_TEXT);
    expect(result.summary).toEqual({ errors: 1, warnings: 2 });
  });

  it("empty list renders `No issues found.` for text mode", () => {
    const result = render([], { format: "text", color: "never" });
    expect(result.stdout).toBe("No issues found.");
    expect(result.summary).toEqual({ errors: 0, warnings: 0 });
  });

  it("empty JSON has summary {errors:0, warnings:0} and diagnostics:[]", () => {
    const result = render([], { format: "json" });
    const parsed = JSON.parse(result.stdout) as {
      summary: { errors: number; warnings: number };
      diagnostics: unknown[];
    };
    expect(parsed.summary).toEqual({ errors: 0, warnings: 0 });
    expect(parsed.diagnostics).toEqual([]);
  });

  it("errorsOnly drops warnings from output but counts them in summary", () => {
    const result = render(ALL_DIAGNOSTICS, {
      format: "text",
      color: "never",
      errorsOnly: true,
    });
    expect(result.stdout).toContain("error[unused-export]");
    expect(result.stdout).not.toContain("warning[");
    expect(result.summary).toEqual({ errors: 1, warnings: 2 });
  });

  it("JSON errorsOnly drops warnings but still counts them", () => {
    const result = render(ALL_DIAGNOSTICS, {
      format: "json",
      errorsOnly: true,
    });
    const parsed = JSON.parse(result.stdout) as {
      summary: { errors: number; warnings: number };
      diagnostics: { level: string }[];
    };
    expect(parsed.summary).toEqual({ errors: 1, warnings: 2 });
    expect(parsed.diagnostics.every((d) => d.level === "error")).toBe(true);
  });

  it("legacy noColor disables color", () => {
    const result = render(ALL_DIAGNOSTICS, { format: "text", noColor: true });
    expect(result.stdout).not.toContain("\x1b[");
  });
});
