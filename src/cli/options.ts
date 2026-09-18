/**
 * Shared options shape for command implementations.
 *
 * Every CLI command (lint, check-config, dry-run, version, help) is a
 * pure function `Command(opts) -> Promise<number>` that returns an
 * `ExitCode` value. This is the contract that `runCli()` composes
 * against.
 *
 * Keeping commands pure (no `process.exit`, no `console.log`) lets us
 * unit-test them by injecting a `Streams` bundle and capturing stdout
 * / stderr into in-memory buffers.
 */
import type { FilePath, SourceText } from "../types.js";
import type { Streams } from "./streams.js";

/**
 * Output formats the CLI understands.
 *
 * - `text`: human-readable text renderer (default).
 * - `json`: machine-readable report.
 *
 * `compact` is reserved for the polish batch and intentionally not
 * accepted yet — commander will reject it as an unknown value.
 */
export type OutputFormat = "text" | "json";

/** Color policy. `auto` mirrors the Rust original (TTY + `NO_COLOR`). */
export type ColorMode = "auto" | "always" | "never";

/**
 * Parsed / validated command-line options shared by every command.
 *
 * `paths` is the trailing-arg list (may be empty when the command
 * relies on config-driven discovery). `config` is the explicit
 * `--config` override or `undefined` to mean "discover".
 */
export interface CliOptions {
  /** Trailing positional arguments — files / dirs to lint. */
  readonly paths: readonly string[];
  /** Override config path (skips discovery). */
  readonly config?: string;
  /** Exit after validating config + rule files; no lint. */
  readonly checkConfig: boolean;
  /** Print Jev requests as JSON; no network calls. */
  readonly dryRun: boolean;
  /** Diagnostic output format (default `text`). */
  readonly format: OutputFormat;
  /** Hide warnings from rendered output. */
  readonly errorsOnly: boolean;
  /** Exit 1 when warnings are present. */
  readonly denyWarnings: boolean;
  /** Concurrency for Jev requests. */
  readonly jobs: number;
  /** Color policy for text output. */
  readonly color: ColorMode;
}

/**
 * Subset of `process.env` we read. Declared as a parameter (not a
 * direct `process.env` access) so tests can inject environment without
 * mutating globals.
 */
export interface Environment {
  readonly jev_key?: string;
  readonly NO_COLOR?: string;
}

/** A pair of files / source text for the runner to lint. */
export interface SourceFile {
  readonly path: FilePath;
  readonly text: SourceText;
}

/**
 * Bundle handed to every command. Bundling the streams + environment
 * makes the contract obvious at the call site and lets us add more
 * injection points (e.g. a clock or fetch) without changing every
 * command signature.
 */
export interface CommandContext {
  readonly streams: Streams;
  readonly env: Environment;
  /** Process working directory (so commands can resolve relative paths). */
  readonly cwd: string;
  /** The package version (used by `--version`). */
  readonly version: string;
}
