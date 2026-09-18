/**
 * stderr progress reporter.
 *
 * Optional in v1; the runner invokes this from `run()` after each batch
 * completes. Hidden when `TS_SEMANTIC_LINT_QUIET=1` is set.
 */
import type { Diagnostic } from "../types.js";

/** Environment variable that suppresses progress output when `"1"`. */
const QUIET_ENV = "TS_SEMANTIC_LINT_QUIET";

/** Return `true` when the user has requested quiet mode. */
export function isQuiet(): boolean {
  return process.env[QUIET_ENV] === "1";
}

/**
 * Emit one progress line summarizing how many files / targets / diagnostics
 * the run has produced so far.
 */
export function reportProgress(args: {
  readonly filesScanned: number;
  readonly targetsEvaluated: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly stream?: NodeJS.WritableStream;
}): void {
  if (isQuiet()) return;
  const out = args.stream ?? process.stderr;
  const diag =
    args.diagnostics.length === 1
      ? "1 diagnostic"
      : `${args.diagnostics.length} diagnostics`;
  out.write(
    `ts-semantic-lint: evaluated ${args.targetsEvaluated} target(s) in ${args.filesScanned} file(s) (${diag})\n`,
  );
}