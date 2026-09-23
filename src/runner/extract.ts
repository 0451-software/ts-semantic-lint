/**
 * `extractAll` — read every file from disk and extract its `LintedTarget[]`.
 *
 * Mirrors the per-file loop in `runner.rs::Plan::build`. Any `SyntaxError`
 * raised by `extractTargets` aborts the whole run before any Jev request is
 * sent — matches the Rust original (`runner.rs` parses all files before
 * sending any evaluation, and parse errors propagate up).
 */
import { promises as fs } from "node:fs";

import { extractTargets } from "../analyzer/index.js";
import type { LintedTarget } from "../types.js";

/**
 * Read each file and run the analyzer. Returns the concatenated list of
 * `LintedTarget` across all files, in input order. Targets from the same
 * file appear in extraction order (depth-first).
 *
 * @throws `SyntaxError` if any file fails to parse. The error message
 *   includes the file path and the underlying analyzer message.
 * @throws `Error` if a file cannot be read (e.g. permission denied).
 */
export async function extractAll(
  files: readonly string[],
): Promise<LintedTarget[]> {
  const out: LintedTarget[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = await fs.readFile(file, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`cannot read ${file}: ${detail}`);
    }
    // `extractTargets` throws `SyntaxError` on parse failure. Let it
    // propagate — the caller decides how to surface it (CLI exit code,
    // logger, …).
    const targets = extractTargets(source, file);
    for (const t of targets) {
      out.push(t);
    }
  }
  return out;
}
