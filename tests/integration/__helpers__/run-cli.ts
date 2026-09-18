/**
 * Test helper for spawning the `ts-semantic-lint` CLI as a child process
 * and capturing stdout / stderr / exit code.
 *
 * The integration suite treats the CLI as a black box — every test
 * shells out to `node dist/cli.js` rather than importing internal
 * modules. This is the only way to exercise the full pipeline
 * (CLI → runner → JevClient → output) end-to-end.
 *
 * In CI / local dev, run `npm run build` first so `dist/cli.js` exists.
 * The helper resolves the CLI entry via `import.meta.url` (dist sibling
 * of `src/`) so the tests work from the package root without env vars.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A single CLI invocation's captured output. */
export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Wall-clock duration of the spawn in ms. */
  readonly durationMs: number;
  /**
   * Parsed JSON when `--format json` was passed and stdout was valid
   * JSON; otherwise `undefined`. Wraps the parse so callers can stay
   * terse.
   */
  readonly json: unknown;
}

export interface RunCliOptions {
  /** argv after `node dist/cli.js` (e.g. `["--check-config", "--config", path]`). */
  readonly argv: readonly string[];
  /** Working directory for the child. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /**
   * Extra environment variables to expose to the child. The parent's
   * `process.env` is merged in by default so things like `PATH`
   * survive.
   */
  readonly env?: NodeJS.ProcessEnv;
  /** Per-call timeout in ms. Defaults to 90_000 (90s). */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Resolve the path to the built CLI binary. Tests are written against
 * the compiled JS (so we exercise what users actually run), not the
 * `tsx` source loader.
 */
export function cliEntryPath(): string {
  // tests/integration/__helpers__/run-cli.ts
  // → ../../../dist/cli.js
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "dist", "cli.js");
}

/**
 * Spawn the CLI with the given argv and capture stdout / stderr /
 * exit code. Returns once the child exits or the timeout fires.
 *
 * On timeout, the child is killed and the resolved object reports the
 * partial output so a stuck test can still print what was captured.
 *
 * Environment forwarding:
 *   - The parent's `process.env` is merged in by default.
 *   - `TYPESAFE_API_KEY` is automatically translated to `jev_key` (the
 *     variable the CLI actually reads) when the caller does not pass
 *     a `jev_key` explicitly.
 */
export function runCli(opts: RunCliOptions): Promise<CliResult> {
  const entry = cliEntryPath();
  const cwd = opts.cwd ?? process.cwd();
  const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  if (env["jev_key"] === undefined && typeof env["TYPESAFE_API_KEY"] === "string") {
    env["jev_key"] = env["TYPESAFE_API_KEY"];
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const start = Date.now();
  return new Promise<CliResult>((resolveP) => {
    const child = spawn(process.execPath, [entry, ...opts.argv], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const exitCode = killed ? 124 : code ?? (signal === "SIGKILL" ? 137 : 1);
      const trimmed = stdout.trim();
      let json: unknown = undefined;
      if (trimmed.length > 0) {
        try {
          json = JSON.parse(trimmed);
        } catch {
          // Non-JSON output (e.g. text format). Leave `json` as undefined.
        }
      }
      resolveP({
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - start,
        json,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolveP({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: `ts-semantic-lint spawn failed: ${err.message}\n`,
        exitCode: 127,
        durationMs: Date.now() - start,
        json: undefined,
      });
    });
  });
}

/**
 * Type-safe view of the JSON output produced by the runner with
 * `--format json`. Shape mirrors `output/json.ts::buildJson`.
 */
export interface LintJsonReport {
  readonly summary: { readonly errors: number; readonly warnings: number };
  readonly diagnostics: readonly LintDiagnostic[];
}

export interface LintDiagnostic {
  readonly ruleId: string;
  readonly level: "warn" | "error";
  readonly file: string;
  readonly range: unknown;
  readonly snippet: string;
  readonly message: string;
  readonly confidence?: number;
  readonly choice?: string;
  readonly answer?: {
    readonly choice: string;
    readonly confidence: number;
    readonly probabilities: Readonly<Record<string, number>>;
  };
}

/** Narrow `unknown` (from `JSON.parse`) into a `LintJsonReport`. */
export function asLintReport(value: unknown): LintJsonReport {
  if (typeof value !== "object" || value === null) {
    throw new Error(`expected object, got ${typeof value}`);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj["diagnostics"] !== "object" || obj["diagnostics"] === null) {
    throw new Error("missing diagnostics field");
  }
  return value as LintJsonReport;
}

/**
 * Type-safe view of the `--dry-run` JSON plan. Mirrors
 * `runner::buildRequests`.
 */
export interface DryRunPlan {
  readonly requests: readonly {
    readonly model: string;
    readonly state: Readonly<Record<string, unknown>>;
    readonly questions: Readonly<Record<string, unknown>>;
  }[];
  readonly targets: number;
}

export function asDryRunPlan(value: unknown): DryRunPlan {
  if (typeof value !== "object" || value === null) {
    throw new Error(`expected object, got ${typeof value}`);
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj["requests"])) {
    throw new Error("missing requests array");
  }
  return value as DryRunPlan;
}
