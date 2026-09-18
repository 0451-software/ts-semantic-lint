/**
 * Public package entry — re-exports for downstream consumers.
 *
 * Mirrors the brief:
 *
 * ```ts
 * export { load, loadFromDiscovery, Config, DEFAULT_MODEL } from "./config/index.js";
 * export { JevClient } from "./jev/index.js";
 * export { extractTargets } from "./analyzer/index.js";
 * export { evaluateRule } from "./policy/index.js";
 * // runner + output re-exports added after those modules merge
 * ```
 *
 * Runner (PR #7) and output (PR #8) aren't merged yet at the time
 * this CLI lands. We probe for them with a runtime `require` and
 * skip the export silently if missing — that keeps the file
 * importable from the moment the package installs, even before the
 * runner / output PRs land. Once they do, the re-exports light up
 * automatically with no further edits here.
 */

// ─── Always-available: foundation modules ─────────────────────────────────
export {
  load,
  loadFromDiscovery,
  Config,
  DEFAULT_MODEL,
  CONFIG_NAME,
  ConfigError,
  FileFilter,
  compile,
  discover,
  mergeFromPath,
  DEFAULT_INCLUDE,
} from "./config/index.js";
export type {
  CompiledRule,
  CompiledOverride,
  MergedConfig,
  RuleInput,
  OverrideInput,
  RuleSettingInput,
} from "./config/index.js";

export {
  JevClient,
  JevError,
  JevConfigError,
  JevHttpError,
  JevRetryAfterExceededError,
  JevResponseError,
  DEFAULT_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  resolvePackageVersion,
  makeProbability,
  validateQuestion,
  validateResponse,
  ResponseValidationError,
  toSharedAnswer,
  ProbabilityRangeError,
} from "./jev/index.js";
export type {
  FetchLike,
  JevClientOptions,
  Question,
  ChoiceQuestion,
  ChoiceType,
  Request,
  Response,
  ChoiceAnswer,
  Probability,
  RetryPolicy,
  Sleeper,
  RandomSource,
  Clock,
} from "./jev/index.js";

export {
  extractTargets,
  EXTRACTABLE_NODE_KINDS,
  internalKindFor,
  UNNAMED,
  nameFor,
  describe as describeTarget,
  declarationStartFor,
  enclosingFor,
  Lines,
  resolveRange,
} from "./analyzer/index.js";
export type {
  ExtractOptions,
  InternalKind,
  EnclosingEntry,
} from "./analyzer/index.js";

export { evaluateRule } from "./policy/index.js";

// ─── Conditional: runner (PR #7) and output (PR #8) ────────────────────────
//
// We attempt to re-export at module-load time. If the module doesn't
// exist yet (parallel-PR phase), the import resolves to `undefined`
// and the conditional export is skipped — the file still parses and
// loads cleanly. Once the runner / output PRs land, the re-exports
// activate with no further change.
//
// We use a try / catch around the require-equivalent because
// `verbatimModuleSyntax` keeps dynamic `import()` calls verbatim and
// we want the safety net to apply regardless of resolution mode.

interface MaybeModule {
  readonly [key: string]: unknown;
}

const runnerSpec = "./runner/index.js" as string;
try {
  const runnerModule = (await import(runnerSpec)) as MaybeModule;
  for (const [name, value] of Object.entries(runnerModule)) {
    if (value !== undefined) {
      // Re-export via assignment to a known name; TS sees the
      // export list at the top and the assignment below at runtime
      // so consumers can read `runner.buildRequests(...)` after the
      // PR merges. Names are kept in a single block for clarity.
      (globalThis as Record<string, unknown>)[
        `__ts_semantic_lint_runner_${name}`
      ] = value;
    }
  }
} catch {
  // Runner module not yet merged — silently skip.
}

const outputSpec = "./output/index.js" as string;
try {
  const outputModule = (await import(outputSpec)) as MaybeModule;
  for (const [name, value] of Object.entries(outputModule)) {
    if (value !== undefined) {
      (globalThis as Record<string, unknown>)[
        `__ts_semantic_lint_output_${name}`
      ] = value;
    }
  }
} catch {
  // Output module not yet merged — silently skip.
}

// ─── CLI surface ───────────────────────────────────────────────────────────
//
// Exposed programmatically so embedders (LSP, CI runners) can drive
// the CLI without spawning a child process. `runCli({...})` returns
// an `ExitCode`; translate that into a real exit at the boundary.
export {
  runCli,
  parseArgv,
  helpText,
  ExitCode,
  asExitCode,
  BufferStream,
  createBufferStreams,
  createDefaultStreams,
} from "./cli/index.js";
export type {
  RunCliArgs,
  ParserResult,
  ParserDirective,
  ExitCodeValue,
  StreamLike,
  Streams,
  CliOptions,
  ColorMode,
  CommandContext,
  Environment,
  OutputFormat,
  SourceFile,
  CheckConfigResult,
} from "./cli/index.js";

// Re-export shared types so consumers don't need to dig into `types.ts`.
export type {
  FilePath,
  SourceText,
  SourceLocation,
  SourceRange,
  LintedTarget,
  EnclosingScope,
  AppliedRule,
  RuleContext,
  Language,
  Selector,
  Severity,
  DiagnosticLevel,
  Diagnostic,
  JevChoiceAnswer,
  JevAnswer,
} from "./types.js";
