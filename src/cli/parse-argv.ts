/**
 * commander-based argv parser for the CLI.
 *
 * `parseArgv(argv)` returns either a `CliOptions` object ready for a
 * command implementation or a `ParserDirective` describing a special
 * early-exit case (`--version`, `--help`, or `parseError`).
 *
 * The parser never calls `process.exit` and never writes to stdout /
 * stderr itself — `runCli()` decides what to do with a directive.
 */
import { Command, Option } from "commander";

import { ExitCode } from "./exit-codes.js";
import type { CliOptions, ColorMode, OutputFormat } from "./options.js";

const DEFAULT_JOBS = 64;

export type ParserDirective =
  | { readonly kind: "version" }
  | { readonly kind: "help"; readonly text: string }
  | { readonly kind: "parseError"; readonly message: string };

export type ParserResult =
  { readonly kind: "options"; readonly options: CliOptions } | ParserDirective;

/**
 * Parse argv into either structured options or an early-exit
 * directive. The argv should NOT include the leading `node` / script
 * name — those are stripped by the caller.
 */
export function parseArgv(argv: readonly string[]): ParserResult {
  // Handle --version / --help before invoking commander so we can
  // return our own `version` directive (which carries no string, so
  // `runCli()` resolves the package version from its own context) and
  // our own help text. Commander's built-in `--version` is disabled
  // because it tries to print directly to stdout / stderr.
  if (hasHelpFlag(argv)) {
    return { kind: "help", text: buildCommand().helpInformation() };
  }
  if (hasVersionFlag(argv)) {
    return { kind: "version" };
  }

  const cmd = buildCommand();

  let parseError: string | undefined;
  try {
    cmd.parse([...argv], { from: "user" });
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  if (parseError !== undefined) {
    return { kind: "parseError", message: parseError };
  }

  const opts = cmd.opts<RawCommanderOpts>();
  const paths = cmd.args as readonly string[];
  const options: CliOptions = {
    paths,
    ...(opts.config !== undefined ? { config: opts.config } : {}),
    checkConfig: opts.checkConfig === true,
    dryRun: opts.dryRun === true,
    format: opts.format ?? "text",
    errorsOnly: opts.errorsOnly === true,
    denyWarnings: opts.denyWarnings === true,
    jobs: opts.jobs ?? DEFAULT_JOBS,
    color: opts.color ?? "auto",
  };
  return { kind: "options", options };
}

interface RawCommanderOpts {
  readonly config?: string;
  readonly checkConfig?: boolean;
  readonly dryRun?: boolean;
  readonly format?: OutputFormat;
  readonly errorsOnly?: boolean;
  readonly denyWarnings?: boolean;
  readonly jobs?: number;
  readonly color?: ColorMode;
}

function buildCommand(): Command {
  const cmd = new Command();
  cmd
    .name("ts-semantic-lint")
    .description("Configurable TypeScript semantic linter powered by Jev")
    .helpOption("--help", "Print usage")
    .exitOverride();

  cmd.argument("[paths...]", "Files/dirs to lint (default: scan config dir)");

  cmd.option(
    "--config <path>",
    "Override config discovery (skips walking up from cwd)",
  );
  cmd.addOption(
    new Option("--check-config", "Validate + exit, no lint").conflicts([
      "--dry-run",
    ]),
  );
  cmd.addOption(
    new Option("--dry-run", "Print Jev requests as JSON, no network").conflicts(
      ["--check-config"],
    ),
  );
  cmd.addOption(
    new Option("--format <fmt>", "Output format (default: text)").choices([
      "text",
      "json",
    ]),
  );
  cmd.option("--errors-only", "Hide warnings from output");
  cmd.option("--deny-warnings", "Exit 1 when warnings are present");
  cmd.option("--jobs <N>", "Concurrency (default 64)", parseJobs, DEFAULT_JOBS);
  cmd.addOption(
    new Option("--color <mode>", "Color policy")
      .choices(["auto", "always", "never"])
      .default("auto"),
  );
  return cmd;
}

function parseJobs(value: string, _previous: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--jobs must be a positive integer (got "${value}")`);
  }
  return n;
}

function hasHelpFlag(argv: readonly string[]): boolean {
  return argv.some((a) => a === "--help" || a === "-h");
}

function hasVersionFlag(argv: readonly string[]): boolean {
  return argv.some((a) => a === "--version" || a === "-V");
}

/**
 * Convenience: return only the `--help` text. Useful when the CLI is
 * invoked through a wrapper that doesn't go through `parseArgv`.
 */
export function helpText(): string {
  return buildCommand().helpInformation();
}

// Re-export so consumers can compare against the exit code constants
// without a second import.
export { ExitCode };
