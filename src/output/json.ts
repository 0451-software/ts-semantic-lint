/**
 * JSON renderer for diagnostics.
 *
 * Produces a stable, parseable envelope: a top-level object with
 * `summary` (`{ errors, warnings }`) and `diagnostics` (one entry per
 * diagnostic, including the full `answer` block).
 *
 * `JSON.stringify` is given no spaces or extra arguments, so output is
 * deterministic and minimal — easy to diff, easy to parse with
 * `JSON.parse` in tests.
 */
import type { Diagnostic } from "../types.js";

import { sortDiagnostics } from "./sort.js";

export interface JsonSummary {
  readonly errors: number;
  readonly warnings: number;
}

export interface JsonRenderResult {
  readonly summary: JsonSummary;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Compute the `{errors, warnings}` summary by counting the input list.
 * This is the authoritative count — the renderer does not recount.
 *
 * Note: this counts *all* diagnostics in `diagnostics`. Callers using
 * `errorsOnly` filtering should pass the un-filtered list here.
 */
export function summarize(diagnostics: readonly Diagnostic[]): JsonSummary {
  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    if (d.level === "error") errors++;
    else if (d.level === "warn") warnings++;
  }
  return { errors, warnings };
}

/**
 * Produce the parsed envelope (no serialization yet). The `diagnostics`
 * field is sorted; the `summary` is computed over the same list.
 */
export function buildJson(diagnostics: readonly Diagnostic[]): JsonRenderResult {
  const sorted = sortDiagnostics(diagnostics);
  return {
    summary: summarize(sorted),
    diagnostics: sorted,
  };
}

/**
 * Serialize to a string with `JSON.stringify`. `errorsOnly` callers can
 * pass the filtered list as `diagnostics` — but for the documented
 * "summary still counts hidden warnings" behavior, pass the full list
 * and a separately-filtered diagnostics array. The two-argument form
 * below does this for you.
 */
export function renderJson(diagnostics: readonly Diagnostic[]): string {
  return JSON.stringify(buildJson(diagnostics));
}

/**
 * Serialize with `summary` computed over `all` and `diagnostics`
 * containing only `shown`. This is the form the runner uses for the
 * `errorsOnly` flag — counts stay authoritative.
 */
export function renderJsonWithSummary(
  shown: readonly Diagnostic[],
  all: readonly Diagnostic[],
): string {
  return JSON.stringify({
    summary: summarize(all),
    diagnostics: sortDiagnostics(shown),
  });
}
