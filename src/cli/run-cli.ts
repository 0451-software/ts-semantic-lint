/**
 * `runCli` — orchestrate argv parsing → command dispatch → exit code.
 *
 * Pure function (in the test-friendly sense): no `process.exit`, no
 * `console.log`. It returns the exit code as a number and writes any
 * user-facing text through the supplied `Streams`.
 *
 * The bin entry at `src/cli.ts` is the only caller that uses
 * `createDefaultStreams()` and translates the return value into a
 * real `process.exit(code)`.
 */
import { runCheckConfig } from "./commands/check-config.js";
import { runDryRun } from "./commands/dry-run.js";
import { runLint } from "./commands/lint.js";
import { runVersion } from "./commands/version.js";
import { ExitCode } from "./exit-codes.js";
import { parseArgv } from "./parse-argv.js";
import type { CommandContext, CliOptions } from "./options.js";
import type { Streams } from "./streams.js";

export interface RunCliArgs {
  readonly argv: readonly string[];
  readonly streams: Streams;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
}

/**
 * Run the CLI with the given argv / streams / environment. Returns
 * the exit code that `process.exit` should be called with.
 *
 * Tests use this directly with `createBufferStreams()` to assert
 * against captured output without spawning a child process.
 */
export async function runCli(args: RunCliArgs): Promise<number> {
  const parsed = parseArgv(args.argv);
  if (parsed.kind === "help") {
    args.streams.stdout.write(parsed.text);
    if (!parsed.text.endsWith("\n")) {
      args.streams.stdout.write("\n");
    }
    return ExitCode.Success;
  }
  if (parsed.kind === "parseError") {
    args.streams.stderr.write(`ts-semantic-lint: ${parsed.message}\n`);
    return ExitCode.OperationalError;
  }
  if (parsed.kind === "version") {
    return runVersion(buildContext(args));
  }

  const opts: CliOptions = parsed.options;
  const ctx = buildContext(args);

  // The brief lists `--check-config`, `--dry-run`, and the default
  // (lint) as the three modes. Dispatch in the order the user asked
  // for — check-config first because it's strictly cheaper than
  // dry-run, and dry-run before lint because lint is the only mode
  // that hits the network.
  if (opts.checkConfig) {
    return runCheckConfig(ctx, opts);
  }
  if (opts.dryRun) {
    return runDryRun(ctx, opts);
  }
  return runLint(ctx, opts);
}

function buildContext(args: RunCliArgs): CommandContext {
  const jev_key = readString(args.env.jev_key);
  const NO_COLOR = readString(args.env.NO_COLOR);
  const env = {
    ...(jev_key !== undefined ? { jev_key } : {}),
    ...(NO_COLOR !== undefined ? { NO_COLOR } : {}),
  };
  return {
    streams: args.streams,
    env,
    cwd: args.cwd,
    version: args.version,
  };
}

function readString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  return value.length === 0 ? undefined : value;
}
