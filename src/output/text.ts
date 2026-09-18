/**
 * Rust-style text renderer for diagnostics.
 *
 * Mirrors `src/output.rs` from ErisLint (Rust original): one block per
 * diagnostic, with a `level[ruleId]: message` header, a `--> file:line:col`
 * pointer, and a multi-line excerpt with `^^^^` carets under the
 * identifier whose range matches `range.start`.
 *
 * Color is applied through the `paint()` helper, which becomes a no-op
 * when the caller passes `enabled = false`. The function is otherwise
 * pure — no I/O, no env reads.
 */
import type { Diagnostic, SourceLocation } from "../types.js";

import { paint } from "./ansi.js";
import { sortDiagnostics } from "./sort.js";

export interface TextRenderOptions {
  /** When `false`, ANSI escape sequences are elided from the output. */
  readonly color: boolean;
}

const GUTTER_WIDTH = 3;

/**
 * Locate the identifier inside the *first* line of `snippet` whose start
 * column matches `column` (the start of the diagnostic range). Falls back
 * to the first identifier-shaped token on that first line, then to a
 * single-caret pointer at the start.
 *
 * Returned as a `[startCol, endCol]` range, both 1-indexed and inclusive
 * on both ends (matching how `^^^^` rows are drawn).
 */
function identifierSpan(
  firstLine: string,
  column: number,
): { start: number; end: number } {
  const candidate = columnWithinSnippet(firstLine, column);
  if (candidate) return candidate;
  const first = firstIdentifier(firstLine);
  if (first) return first;
  return { start: 1, end: 1 };
}

function columnWithinSnippet(
  snippet: string,
  column: number,
): { start: number; end: number } | undefined {
  if (column < 1 || column - 1 >= snippet.length) return undefined;
  const slice = snippet.slice(column - 1);
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(slice);
  if (!match) return undefined;
  return { start: column, end: column + match[0].length - 1 };
}

function firstIdentifier(snippet: string): { start: number; end: number } | undefined {
  const match = /[A-Za-z_$][A-Za-z0-9_$]*/.exec(snippet);
  if (!match) return undefined;
  return { start: match.index + 1, end: match.index + match[0].length };
}

/**
 * Build the `^^^^^` underline row. The caret row spans `start..end`
 * inclusive; the gutter is padded to `GUTTER_WIDTH` characters.
 */
function buildCaretRow(start: number, end: number, color: boolean): string {
  const gutter = " ".repeat(GUTTER_WIDTH);
  const head = " ".repeat(Math.max(0, start - 1));
  const carets = "^".repeat(Math.max(1, end - start + 1));
  return `${gutter}| ${head}${paint(carets, ["red"], color)}`;
}

/**
 * Format a 1-based line/column location as `line:column`. Used by the
 * `--> file:line:column` pointer line.
 */
function formatLocation(loc: SourceLocation): string {
  return `${loc.line}:${loc.column}`;
}

/**
 * Format a 1-based line as the gutter prefix on the source-excerpt row.
 * Rust's `annotate-snippets` shows just the line number on excerpt rows.
 */
function formatGutter(line: number): string {
  return String(line);
}

/**
 * Pad a single gutter value so the column for the `|` separator lands
 * at the same index regardless of how many digits the line number has.
 */
function padGutter(text: string): string {
  return text.padStart(GUTTER_WIDTH - 1, " ");
}

/** Render a sorted list of diagnostics into a single Rust-style text block. */
export function renderText(
  diagnostics: readonly Diagnostic[],
  options: TextRenderOptions,
): string {
  const sorted = sortDiagnostics(diagnostics);
  return sorted.map((d) => renderOne(d, options)).join("\n\n");
}

function renderOne(d: Diagnostic, options: TextRenderOptions): string {
  const color = options.color;
  const levelLabel =
    d.level === "error"
      ? paint("error", ["bold", "red"], color)
      : paint("warning", ["bold", "yellow"], color);
  const header = `${levelLabel}[${d.ruleId}]: ${d.message}`;
  const pointer = ` ${paint("-->", ["blue"], color)} ${d.file}:${formatLocation(d.range.start)}`;

  // The excerpt row(s): one gutter-numbered row per *line* of the snippet.
  // The caret row appears immediately below the line where the range starts.
  const startLine = d.range.start.line;
  const lines = d.snippet.split("\n");
  const excerptLines: string[] = [];
  const span = identifierSpan(lines[0] ?? "", d.range.start.column);
  for (let i = 0; i < lines.length; i++) {
    const ln = startLine + i;
    const text = lines[i] ?? "";
    excerptLines.push(` ${padGutter(formatGutter(ln))} | ${text}`);
    if (i === 0) {
      excerptLines.push(buildCaretRow(span.start, span.end, color));
    }
  }

  const pipe = "|";
  return [header, pointer, pipe, ...excerptLines].join("\n");
}
