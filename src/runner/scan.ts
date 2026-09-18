/**
 * File-system scan — turn a list of input paths into a deduplicated,
 * config-filtered, sorted list of absolute source file paths.
 *
 * Behavior (mirrors `runner.rs::source_files`):
 *
 * - Each input is tested against `config.filter.matches()`; non-matching
 *   paths are dropped.
 * - Directories are walked recursively (depth-first, no symlink following).
 * - `node_modules`, `dist`, `.git`, `coverage`, `target` are always
 *   excluded — they cannot be opted into. This is layered on top of the
 *   user-supplied exclude globs.
 * - Output is absolute, sorted ascending, deduplicated.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { Config } from "../config/index.js";

/** Always-excluded directory names — same set as `config/filter.ts`. */
export const ALWAYS_EXCLUDED: readonly string[] = Object.freeze([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "target",
]);

/** A directory is filtered out when any path segment matches an excluded name. */
function containsExcludedSegment(absPath: string): boolean {
  const parts = absPath.split(path.sep);
  return parts.some((p) => ALWAYS_EXCLUDED.includes(p));
}

/**
 * Recursively enumerate every regular file under `root`. Symlinks are not
 * followed. Excluded-directory segments are pruned — once we descend into one,
 * nothing below it is visited.
 */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ALWAYS_EXCLUDED.includes(entry.name)) continue;
        await visit(child);
        continue;
      }
      if (entry.isFile()) {
        out.push(child);
      }
      // Symlinks and other types are ignored.
    }
  }
  await visit(root);
  return out;
}

/**
 * Resolve `input` to an absolute path. Missing files surface as the
 * unresolved path — the downstream `matches()` call will reject them when
 * the path fails the project filter.
 */
async function safeRealpath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.isAbsolute(input) ? input : path.resolve(input);
  }
}

/**
 * Scan the input paths and return the deduplicated, sorted set of files
 * that pass `config.filter.matches()`.
 *
 * @param inputs Paths from the CLI — files, directories, or globs.
 * @param config The compiled config supplying the include / exclude filter.
 */
export async function scan(
  inputs: readonly string[],
  config: Config,
): Promise<readonly string[]> {
  // 1. Resolve each input to a set of candidate files (directories walked).
  const candidates = new Set<string>();
  for (const input of inputs) {
    const abs = await safeRealpath(input);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      // Path does not exist; the filter step will drop it.
      candidates.add(abs);
      continue;
    }
    if (stat.isDirectory()) {
      const files = await walkFiles(abs);
      for (const f of files) {
        if (containsExcludedSegment(f)) continue;
        candidates.add(f);
      }
    } else if (stat.isFile()) {
      if (!containsExcludedSegment(abs)) {
        candidates.add(abs);
      }
    }
  }

  // 2. Apply the config filter (include + exclude). Always-excluded
  //    directories are already removed by `containsExcludedSegment`, so
  //    the filter only needs to honor user-supplied include/exclude.
  const filtered: string[] = [];
  for (const file of candidates) {
    if (await config.filter.matches(file, config.root)) {
      filtered.push(file);
    }
  }

  // 3. Sort + dedupe (Set already dedupes, but we sort explicitly).
  filtered.sort();
  return filtered;
}