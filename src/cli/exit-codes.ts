/**
 * Exit-code mapping for the CLI. Mirrors the ErisLint convention so
 * users can wire the same CI logic on top of either implementation.
 *
 * The bin entry at `src/cli.ts` is the only place in the package that
 * calls `process.exit` — every command returns one of these numbers
 * via `runCli()` and lets the entry translate it into a real exit.
 */
export const ExitCode = {
  /** No errors; warnings allowed. */
  Success: 0,
  /** Errors present, OR warnings present with `--deny-warnings`. */
  HasIssues: 1,
  /** Config / parse / auth / API / operational failure. */
  OperationalError: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Coerce an arbitrary value into one of the three exit codes. Anything
 * that isn't a known integer is treated as an operational error so
 * command implementations can `throw` instead of caring about codes.
 */
export function asExitCode(value: number | undefined): ExitCodeValue {
  if (value === ExitCode.Success || value === ExitCode.HasIssues) {
    return value;
  }
  return ExitCode.OperationalError;
}
