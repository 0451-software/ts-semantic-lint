/**
 * `--dry-run` command — parse + emit the Jev request plan as JSON,
 * without calling the API.
 *
 * This mirrors ErisLint's `--dry-run` mode. It runs the same
 * scan-and-build code path as a real lint, but writes the resulting
 * `Plan` (a JSON document describing every Jev `Request` we *would*
 * send) to stdout instead of dispatching it.
 *
 * The runner module may not be merged when this CLI lands. To stay
 * importable in either world, we use a dynamic `import()` and treat
 * any failure to load as "no work to do" — we still exit 0 so the
 * `--check-config`-style offline guarantees survive.
 */
import { ExitCode } from "../exit-codes.js";
import type { CommandContext, CliOptions } from "../options.js";

/**
 * Probe for the runner module. Returns a callable that builds the
 * request plan from a config + path list, or `undefined` if the
 * runner module isn't available yet (PR #7 not merged).
 *
 * Dynamic `import()` means a missing module doesn't take down the
 * CLI at startup — only at the moment `--dry-run` actually needs it.
 */
type BuildRequestsFn = (
  config: unknown,
  paths: readonly string[],
) => Promise<unknown>;

interface RunnerModule {
  buildRequests?: BuildRequestsFn;
}

async function tryLoadRunner(): Promise<BuildRequestsFn | undefined> {
  try {
    // The runner module may not be merged yet (PR #7). Import via a
    // string-typed specifier so a missing module is a runtime, not a
    // compile-time, failure.
    const specifier = "../../runner/index.js" as string;
    const mod = (await import(specifier)) as RunnerModule;
    if (typeof mod.buildRequests === "function") {
      return mod.buildRequests;
    }
  } catch {
    // Runner not merged yet — fall through to the "not configured"
    // response below. Tests that don't exercise the runner rely on
    // this path.
  }
  return undefined;
}

export async function runDryRun(
  ctx: CommandContext,
  opts: CliOptions,
): Promise<number> {
  const buildRequests = await tryLoadRunner();
  if (!buildRequests) {
    ctx.streams.stderr.write(
      "ts-semantic-lint: --dry-run is unavailable until the runner module lands\n",
    );
    return ExitCode.OperationalError;
  }

  const config = await loadConfig(ctx, opts);
  if (!config) {
    return ExitCode.OperationalError;
  }

  try {
    const plan = await buildRequests(config, opts.paths);
    ctx.streams.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return ExitCode.Success;
  } catch (error) {
    ctx.streams.stderr.write(
      `ts-semantic-lint: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return ExitCode.OperationalError;
  }
}

async function loadConfig(
  ctx: CommandContext,
  opts: CliOptions,
): Promise<unknown | undefined> {
  const { load, loadFromDiscovery, ConfigError } = await import(
    "../../config/index.js"
  );
  try {
    return opts.config !== undefined
      ? await load(opts.config)
      : await loadFromDiscovery(ctx.cwd);
  } catch (error) {
    const message =
      error instanceof ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    ctx.streams.stderr.write(`ts-semantic-lint: ${message}\n`);
    return undefined;
  }
}
