/**
 * `extends` and `rule_files` resolution with cycle detection.
 *
 * Mirrors ErisLint's `merge()` function:
 *   - Recursively load `extends` first (depth-first), then merge current
 *     file on top. Last-loaded wins for scalar fields; rules are inserted
 *     by id with last-wins for duplicates; overrides are appended.
 *   - Cycles are detected by tracking the ancestor stack of canonical
 *     paths.
 *   - Maximum extends depth is 64.
 *   - `rule_files` may be a single rule object or an array of rule objects;
 *     both shapes are accepted (matches Rust's `RuleFile` untagged enum).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { ConfigError } from "./filter.js";
import {
  ConfigFileSchema,
  type ConfigFileInput,
  type RuleInput,
} from "./schemas.js";

export const MAX_EXTENDS_DEPTH = 64;

/** Mutable accumulator used while walking the extends tree. */
export interface MergedConfig {
  version: number;
  model: string | null;
  include: string[] | null;
  exclude: string[];
  rules: Map<string, RuleInput>;
  overrides: ConfigFileInput["overrides"];
}

/** Create an empty merge accumulator. */
export function emptyMerged(): MergedConfig {
  return {
    version: 1,
    model: null,
    include: null,
    exclude: [],
    rules: new Map(),
    overrides: [],
  };
}

/**
 * Resolve `extends` + `rule_files` for a single config file. Cycle and
 * depth limits are enforced. The `stack` is the path of canonical
 * ancestors already visited; passing the root starts a fresh chain.
 */
export async function mergeFromPath(
  path: string,
  stack: string[] = [],
): Promise<MergedConfig> {
  const absolute = await canonicalize(path);
  const merged = emptyMerged();
  await loadInto(absolute, [...stack, absolute], merged);
  return merged;
}

async function loadInto(
  path: string,
  stack: readonly string[],
  merged: MergedConfig,
): Promise<void> {
  // Depth + cycle check happens at every entry, not just the root.
  if (stack.length > MAX_EXTENDS_DEPTH) {
    throw new ConfigError(
      `configuration inheritance exceeds ${MAX_EXTENDS_DEPTH} levels at ${path}`,
      path,
    );
  }
  if (stack.slice(0, -1).includes(path)) {
    throw new ConfigError(
      `configuration inheritance cycle at ${path} (stack: ${stack.join(", ")})`,
      path,
    );
  }

  const file = await readAndParse(path);
  const directory = dirname(path);

  // extends — recurse first so current file wins.
  for (const ext of file.extends) {
    const basePath = await resolveExt(directory, ext);
    await loadInto(basePath, [...stack, basePath], merged);
  }

  // Scalars — last writer wins.
  if (file.model !== undefined) merged.model = file.model;
  if (file.include !== undefined) merged.include = [...file.include];
  if (file.exclude !== undefined) merged.exclude = [...file.exclude];
  merged.version = file.version;

  // Rules: collect inline + rule_files, detect duplicates within this file.
  const collected: RuleInput[] = [...file.rules];
  for (const rf of file.rule_files) {
    const resolved = await resolveExt(directory, rf);
    collected.push(...(await readRuleFile(resolved)));
  }
  const seen = new Set<string>();
  for (const rule of collected) {
    if (seen.has(rule.id)) {
      throw new ConfigError(`duplicate rule id "${rule.id}" in ${path}`, path);
    }
    seen.add(rule.id);
    merged.rules.set(rule.id, rule);
  }

  // Overrides — appended in declaration order; later files win positionally.
  for (const ov of file.overrides) {
    merged.overrides.push(ov);
  }
}

/**
 * Parse a JSON file and run it through `ConfigFileSchema`. Throws a
 * `ConfigError` with the file path prefixed on any failure.
 */
async function readAndParse(path: string): Promise<ConfigFileInput> {
  const text = await safeRead(path);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`invalid JSON: ${(err as Error).message}`, path);
  }
  const result = ConfigFileSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`invalid config:\n${issues}`, path);
  }
  return result.data;
}

/**
 * Read a `rule_files` entry. Accepts either a single `Rule` object or a
 * `Rule[]` array. The file is parsed independently of `ConfigFileSchema`
 * so it doesn't need a `version` field.
 */
async function readRuleFile(path: string): Promise<RuleInput[]> {
  const text = await safeRead(path);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`invalid JSON: ${(err as Error).message}`, path);
  }
  // Each rule_file may be a single rule or an array.
  const isArray = Array.isArray(json);
  const { RuleSchema } = await import("./schemas.js");
  if (isArray) {
    const arr = json as unknown[];
    return arr.map((r, idx) => parseOne(RuleSchema, r, path, `[${idx}]`));
  }
  return [parseOne(RuleSchema, json, path)];
}

function parseOne<T>(
  schema: {
    safeParse: (v: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: { path: (string | number)[]; message: string }[] };
        };
  },
  value: unknown,
  path: string,
  pointer = "",
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map(
        (i) =>
          `  - ${pointer}${pointer ? "." : ""}${i.path.join(".") || "(root)"}: ${i.message}`,
      )
      .join("\n");
    throw new ConfigError(`invalid rule file:\n${issues}`, path);
  }
  return result.data;
}

/**
 * Resolve a string path against a base directory, canonicalizing the
 * result so cycle detection works on the real on-disk path.
 */
async function resolveExt(directory: string, ext: string): Promise<string> {
  const joined = isAbsolute(ext) ? ext : resolve(directory, ext);
  return canonicalize(joined);
}

async function canonicalize(p: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  try {
    return await realpath(p);
  } catch (err) {
    if (!existsSync(p)) {
      throw new ConfigError(`cannot open ${p}: ${(err as Error).message}`, p);
    }
    throw new ConfigError(
      `cannot canonicalize ${p}: ${(err as Error).message}`,
      p,
    );
  }
}

async function safeRead(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    throw new ConfigError(
      `cannot read ${path}: ${(err as Error).message}`,
      path,
    );
  }
}
