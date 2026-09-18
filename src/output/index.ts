/**
 * Output module — public entry point.
 *
 * Dispatches to the `text` or `json` renderer based on `RenderOptions.format`.
 * Counts always reflect the *full* input list; `errorsOnly` only affects
 * what is shown.
 *
 * Usage:
 *
 * ```ts
 * import { render } from "./output/index.js";
 *
 * const result = render(diagnostics, { format: "text" });
 * process.stdout.write(result.stdout);
 * console.log(result.summary);
 * ```
 */
import type { Diagnostic } from "../types.js";

import { colorEnabled } from "./ansi.js";
import { renderJson, renderJsonWithSummary, summarize } from "./json.js";
import { renderText } from "./text.js";

export type OutputFormat = "text" | "json"; // "compact" deferred

export type ColorMode = "auto" | "always" | "never";

export interface RenderOptions {
  readonly format: OutputFormat;
  /** Color policy. Default: `"auto"`. */
  readonly color?: ColorMode;
  /** Drop `warn`-level diagnostics from output. Counts are unchanged. */
  readonly errorsOnly?: boolean;
  /** Legacy escape hatch. Equivalent to `color: "never"`. */
  readonly noColor?: boolean;
}

export interface RenderResult {
  /** The rendered text. Always a string; may be empty for empty inputs. */
  readonly stdout: string;
  /** Counts over the *original* diagnostic list, before filtering. */
  readonly summary: { errors: number; warnings: number };
}

/**
 * Resolve the effective `ColorMode` from a `RenderOptions` object,
 * honoring the legacy `noColor` flag.
 */
function resolveColor(options: RenderOptions): ColorMode {
  if (options.color !== undefined) return options.color;
  if (options.noColor === true) return "never";
  return "auto";
}

/**
 * Resolve whether color should actually be emitted. Reads `NO_COLOR`
 * from `process.env` and `process.stdout.isTTY` for `auto` mode.
 */
function resolveColorEnabled(mode: ColorMode): boolean {
  return colorEnabled(mode, Boolean(process.stdout.isTTY), process.env.NO_COLOR);
}

/**
 * Filter the diagnostic list by level. Centralized so the renderer
 * implementations don't each have to know about the filter semantics.
 */
function applyFilter(
  diagnostics: readonly Diagnostic[],
  errorsOnly: boolean,
): readonly Diagnostic[] {
  if (!errorsOnly) return diagnostics;
  return diagnostics.filter((d) => d.level === "error");
}

const EMPTY_TEXT = "No issues found.";

/**
 * Render `diagnostics` according to `options`. Always returns a
 * `RenderResult`; never throws on empty input.
 */
export function render(
  diagnostics: readonly Diagnostic[],
  options: RenderOptions,
): RenderResult {
  const color = resolveColorEnabled(resolveColor(options));
  const filtered = applyFilter(diagnostics, options.errorsOnly === true);

  let stdout: string;
  if (options.format === "json") {
    // Summary is always over the full input list; the diagnostics field
    // reflects whatever filtering the caller asked for.
    stdout = options.errorsOnly === true
      ? renderJsonWithSummary(filtered, diagnostics)
      : renderJson(diagnostics);
  } else {
    if (filtered.length === 0) {
      stdout = EMPTY_TEXT;
    } else {
      stdout = renderText(filtered, { color });
    }
  }

  return { stdout, summary: summarize(diagnostics) };
}
