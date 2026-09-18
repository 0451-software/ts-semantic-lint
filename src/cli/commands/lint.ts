/**
 * Default `lint` command — scan → parse → evaluate → render.
 *
 * Until PR #7 (runner) and PR #8 (output) merge, the wiring is
 * best-effort: this command probes for the runner + output modules and
 * degrades gracefully when they aren't present. The exit-code / stderr
 * contract matches the eventual full implementation so consumers
 * don't need to special-case the in-progress state.
 *
 * Exit codes (matches the brief):
 *   - 0: no errors (warnings allowed)
 *   - 1: errors present, OR warnings present with `--deny-warnings`
 *   - 2: config / parse / auth / API failure
 */
import { ConfigError, load, loadFromDiscovery } from "../../config/index.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandContext, CliOptions } from "../options.js";

/**
 * Shape of the `runner.run(files, options)` we expect post-merge.
 * Declared as a structural type (no `any`) so we can probe for the
 * function without taking a hard dependency.
 */
type RunnerFn = (
  files: readonly string[],
  options: RunnerOptions,
) => Promise<RunnerReport>;

interface RunnerOptions {
  readonly config: unknown;
  readonly client?: unknown;
  readonly jobs: number;
  readonly errorsOnly: boolean;
}

interface RunnerReport {
  readonly diagnostics: readonly { readonly level: "warn" | "error" }[];
}

/**
 * Shape of the `output.render(diagnostics, options)` we expect
 * post-merge.
 */
type OutputRenderFn = (
  diagnostics: readonly unknown[],
  options: {
    readonly format: "text" | "json";
    readonly color: "auto" | "always" | "never";
    readonly errorsOnly?: boolean;
  },
) => { readonly stdout: string } | Promise<{ readonly stdout: string }>;

export async function runLint(
  ctx: CommandContext,
  opts: CliOptions,
): Promise<number> {
  const config = await loadConfigForLint(ctx, opts);
  if (!config) {
    return ExitCode.OperationalError;
  }

  // Require a Jev key for real (non-dry-run) lint. The brief is
  // explicit: a real run without the key is exit 2 with a clear
  // stderr message. We never echo the key value, even if it's a
  // malformed byte string. Check this *before* probing the runner
  // so the user sees the actionable "set jev_key" error rather than
  // an "unavailable module" message they can't act on.
  if (!ctx.env.jev_key || ctx.env.jev_key.length === 0) {
    ctx.streams.stderr.write(
      "ts-semantic-lint: set the jev_key environment variable to your TypeSafe API key (or use --dry-run)\n",
    );
    return ExitCode.OperationalError;
  }

  const runnerFn = await tryLoadRunner();
  if (!runnerFn) {
    ctx.streams.stderr.write(
      "ts-semantic-lint: lint execution is unavailable until the runner module lands\n",
    );
    return ExitCode.OperationalError;
  }

  const { JevClient } = await import("../../jev/index.js");
  const jevClient = new JevClient({ key: ctx.env.jev_key });

  try {
    const report = await runnerFn(opts.paths, {
      config,
      client: jevClient,
      jobs: opts.jobs,
      errorsOnly: opts.errorsOnly,
    });
    const exitCode = computeExitCode(report, opts);
    const render = await tryLoadOutputRender();
    if (render) {
      const rendered = await render(report.diagnostics, {
        format: opts.format,
        color: opts.color,
        errorsOnly: opts.errorsOnly,
      });
      ctx.streams.stdout.write(rendered.stdout);
      if (!rendered.stdout.endsWith("\n")) {
        ctx.streams.stdout.write("\n");
      }
    } else if (opts.format === "json") {
      ctx.streams.stdout.write(
        `${JSON.stringify(
          { evaluations: 0, diagnostics: report.diagnostics },
          null,
          2,
        )}\n`,
      );
    }
    return exitCode;
  } catch (error) {
    ctx.streams.stderr.write(
      `ts-semantic-lint: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return ExitCode.OperationalError;
  }
}

function computeExitCode(report: RunnerReport, opts: CliOptions): number {
  let errors = 0;
  let warnings = 0;
  for (const d of report.diagnostics) {
    if (d.level === "error") errors++;
    else if (d.level === "warn") warnings++;
  }
  if (errors > 0) return ExitCode.HasIssues;
  if (opts.denyWarnings && warnings > 0) return ExitCode.HasIssues;
  return ExitCode.Success;
}

async function loadConfigForLint(
  ctx: CommandContext,
  opts: CliOptions,
): Promise<unknown | undefined> {
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

async function tryLoadRunner(): Promise<RunnerFn | undefined> {
  try {
    const specifier = "../../runner/index.js" as string;
    const mod = (await import(specifier)) as {
      run?: RunnerFn;
    };
    if (typeof mod.run === "function") {
      return mod.run;
    }
  } catch {
    // Module missing — fall through.
  }
  return undefined;
}

async function tryLoadOutputRender(): Promise<OutputRenderFn | undefined> {
  try {
    const specifier = "../../output/index.js" as string;
    const mod = (await import(specifier)) as {
      render?: OutputRenderFn;
    };
    if (typeof mod.render === "function") {
      return mod.render;
    }
  } catch {
    // Module missing — fall through.
  }
  return undefined;
}
