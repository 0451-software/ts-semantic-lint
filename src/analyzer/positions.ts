/**
 * Byte-offset → line/column helpers (port of the `Lines` struct from
 * ErisLint's `src/rust.rs`).
 *
 * Conventions:
 * - Offsets are zero-indexed, end-exclusive (matches `TextRange` in Rust and
 *   `range: [number, number]` in typescript-estree).
 * - Lines and columns are **one-based** (matches IDE / compiler output).
 * - Columns are counted in Unicode code points, not bytes. JavaScript string
 *   indexing operates on UTF-16 code units, so a single emoji or astral-plane
 *   character may be two `String#length` units; we still report columns in
 *   characters per the convention used by TypeScript and most editor tooling.
 */

/**
 * Precomputed line-start offsets for an immutable source string.
 *
 * `starts[i]` is the byte offset of the first character on line `i + 1`
 * (one-based line number). The first entry is always `0`. After a `\n`
 * (byte index `i`), the next entry is `i + 1`.
 */
export class Lines {
  readonly #source: string;
  readonly #starts: readonly number[];

  constructor(source: string) {
    const starts: number[] = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10 /* \n */) {
        starts.push(i + 1);
      }
    }
    this.#source = source;
    this.#starts = starts;
  }

  /** Number of lines (always ≥ 1, even for an empty source). */
  get lineCount(): number {
    return this.#starts.length;
  }

  /**
   * Convert a byte offset to a one-based `(line, column)` pair.
   *
   * `column` is the count of Unicode code points from the start of the line
   * to `offset` (plus one, to match IDE / compiler conventions). An offset
   * exactly at a line start yields column 1.
   */
  position(offset: number): { readonly line: number; readonly column: number } {
    if (this.#starts.length === 0) {
      return { line: 1, column: 1 };
    }
    // partition_point returns the index of the first entry strictly greater
    // than `offset`, which is exactly the line containing `offset`.
    const lineIdx = this.partitionPoint(offset) - 1;
    const safeIdx = lineIdx < 0 ? 0 : lineIdx;
    const lineStart = this.#starts[safeIdx] ?? 0;
    const lineSource = this.#source.slice(lineStart, offset);
    return {
      line: safeIdx + 1,
      column: Array.from(lineSource).length + 1,
    };
  }

  /**
   * `partition_point` analogue for a sorted array of non-negative integers.
   * Returns the smallest index `i` such that `arr[i] > offset`; if no such
   * index exists, returns `arr.length`.
   *
   * Exposed for the helpers below; not part of the public API.
   */
  private partitionPoint(offset: number): number {
    const starts = this.#starts;
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const value = starts[mid] ?? 0;
      if (value <= offset) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}

/**
 * 1-indexed source location. Mirrors the `SourceLocation` from `src/types.ts`
 * but lives here to avoid a circular import from `types.ts` (which itself
 * imports from `@typescript-eslint/typescript-estree`).
 */
export interface ResolvedLocation {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/**
 * Convert a `range: [number, number]` from typescript-estree into the two
 * `SourceLocation`s used by `LintedTarget.range`. Clamps negative offsets to
 * `0` so partially-malformed nodes still produce sane positions.
 */
export function resolveRange(
  lines: Lines,
  range: readonly [number, number],
): { readonly start: ResolvedLocation; readonly end: ResolvedLocation } {
  const [rawStart, rawEnd] = range;
  const startOffset = Math.max(0, rawStart);
  const endOffset = Math.max(startOffset, rawEnd);
  const start = lines.position(startOffset);
  const end = lines.position(endOffset);
  return {
    start: { line: start.line, column: start.column, offset: startOffset },
    end: { line: end.line, column: end.column, offset: endOffset },
  };
}
