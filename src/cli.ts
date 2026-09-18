#!/usr/bin/env node
/**
 * `ts-semantic-lint` — CLI bin entry.
 *
 * This file is the ONLY place in the package that calls `process.exit`.
 * Every other CLI module is pure: parse argv, dispatch to a command,
 * return an `ExitCode` value. The bin entry translates that into a
 * real exit status.
 *
 * Why this separation?
 *   - Tests can import `runCli({...})` directly with mock streams.
 *   - `process.exit` is hostile to test harnesses (it bypasses
 *     cleanup, mocks, and coverage).
 *   - Future embedders (LSP servers, CI runners, webhooks) can drive
 *     the CLI logic without spawning a child process.
 */
import { argv, cwd, env, exit } from "node:process";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createDefaultStreams, runCli } from "./cli/index.js";

/**
 * Resolve the package version by reading `package.json` adjacent to
 * the source. Falls back to `"0.0.0"` if the file can't be read —
 * a defensive default, not a silent failure mode (the bin prints
 * `--version` from here, but tests inject their own version).
 */
function resolvePackageVersion(): string {
  try {
    const here = fileURLToPath(import.meta.url);
    const pkgPath = fileURLToPath(new URL("../package.json", here));
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof (parsed as { version: unknown }).version === "string"
    ) {
      return (parsed as { version: string }).version;
    }
  } catch {
    // Fall through to fallback below.
  }
  return "0.0.0";
}

async function main(): Promise<void> {
  const code = await runCli({
    argv: argv.slice(2),
    streams: createDefaultStreams(),
    cwd: cwd(),
    env,
    version: resolvePackageVersion(),
  });
  exit(code);
}

await main();
