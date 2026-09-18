/**
 * `--check-config` command — load + validate the configuration, exit
 * without linting anything.
 *
 * Mirrors ErisLint's `Cli::check_config` mode: load the config file
 * (via the `--config` override or discovery), confirm it parses,
 * report the number of rules. Any failure surfaces as exit code 2 with
 * a clear stderr message — no Jev key required.
 */
import { ConfigError, load, loadFromDiscovery } from "../../config/index.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandContext, CliOptions } from "../options.js";

export interface CheckConfigResult {
  readonly configPath: string;
  readonly ruleCount: number;
}

export async function runCheckConfig(
  ctx: CommandContext,
  opts: CliOptions,
): Promise<number> {
  try {
    const cfg =
      opts.config !== undefined
        ? await load(opts.config)
        : await loadFromDiscovery(ctx.cwd);
    const result: CheckConfigResult = {
      configPath: cfg.path,
      ruleCount: cfg.rules.size,
    };
    if (opts.format === "json") {
      ctx.streams.stdout.write(
        `${JSON.stringify(
          {
            config: result.configPath,
            rules: result.ruleCount,
            valid: true,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      ctx.streams.stdout.write(
        `Configuration valid: ${result.ruleCount} rules (${result.configPath})\n`,
      );
    }
    return ExitCode.Success;
  } catch (error) {
    writeConfigError(ctx, error);
    return ExitCode.OperationalError;
  }
}

function writeConfigError(ctx: CommandContext, error: unknown): void {
  const message = formatConfigError(error);
  ctx.streams.stderr.write(`ts-semantic-lint: ${message}\n`);
}

function formatConfigError(error: unknown): string {
  if (error instanceof ConfigError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
