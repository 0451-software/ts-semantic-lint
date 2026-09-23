/**
 * Public CLI surface — exported as `./cli` so consumers can run the
 * CLI programmatically (`runCli({...})` or `parseArgv(argv)`) without
 * spawning a child process.
 *
 * This module is intentionally side-effect-free. The bin entry lives
 * in `src/cli.ts` and is the only place that calls `process.exit`.
 */
export {
  BufferStream,
  createBufferStreams,
  createDefaultStreams,
} from "./streams.js";
export type { StreamLike, Streams } from "./streams.js";
export { ExitCode, asExitCode } from "./exit-codes.js";
export type { ExitCodeValue } from "./exit-codes.js";
export { parseArgv, helpText } from "./parse-argv.js";
export type { ParserResult, ParserDirective } from "./parse-argv.js";
export { runCli } from "./run-cli.js";
export type { RunCliArgs } from "./run-cli.js";
export type {
  CliOptions,
  ColorMode,
  CommandContext,
  Environment,
  OutputFormat,
  SourceFile,
} from "./options.js";
export { runCheckConfig } from "./commands/check-config.js";
export type { CheckConfigResult } from "./commands/check-config.js";
export { runDryRun } from "./commands/dry-run.js";
export { runLint } from "./commands/lint.js";
export { runVersion } from "./commands/version.js";
