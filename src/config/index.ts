/**
 * `Config` — top-level configuration object the runner consumes.
 *
 * Responsibilities:
 *   - Hold the merged config (model, file filter, rules, overrides).
 *   - Resolve per-file, per-rule severity via `settingFor()`.
 *   - Carry the canonical config file path + project root for downstream
 *     consumers.
 *
 * The class is constructed by `load()` and `discover()`. Consumers
 * normally only call `settingFor()` to ask "what's the override setting
 * for rule X on file Y?".
 */
import { dirname } from "node:path";

import { CONFIG_NAME } from "./config-name.js";
import { discover } from "./discovery.js";
import { ConfigError, FileFilter } from "./filter.js";
import { mergeFromPath, type MergedConfig } from "./merge.js";
import type { OverrideInput, RuleInput, RuleSettingInput } from "./schemas.js";
import { validateAllRules, validateOverrides } from "./validation.js";

export { CONFIG_NAME, discover, ConfigError, FileFilter, mergeFromPath };
export type { MergedConfig, RuleInput, OverrideInput, RuleSettingInput };

/** Default include globs when config omits `include`. */
export const DEFAULT_INCLUDE: readonly string[] = Object.freeze([
  "**/*.ts",
  "**/*.tsx",
]);

/** Default model identifier when config omits `model`. */
export const DEFAULT_MODEL = "jev-latest";

/**
 * A compiled rule — definition plus the per-rule file filter (the
 * `where.files` / `where.exclude` globs of that specific rule).
 */
export interface CompiledRule {
  readonly definition: RuleInput;
  readonly filter: FileFilter;
}

/**
 * A compiled override block — its file filter + the rule→setting map.
 */
export interface CompiledOverride {
  readonly files: readonly string[];
  readonly exclude: readonly string[];
  readonly filter: FileFilter;
  readonly rules: Readonly<Record<string, RuleSettingInput>>;
}

/**
 * Top-level configuration object handed to the runner. Once constructed
 * by `load()`, it is immutable.
 */
export class Config {
  /** Absolute canonical path to the config file that was loaded. */
  readonly path: string;
  /** Absolute path of the directory containing the config file. */
  readonly root: string;
  /** Model identifier (defaults to "jev-latest"). */
  readonly model: string;
  /** Project-wide file filter (include + exclude globs). */
  readonly filter: FileFilter;
  /** All rules keyed by id. */
  readonly rules: ReadonlyMap<string, CompiledRule>;
  /** Override blocks in declaration order. */
  readonly overrides: readonly CompiledOverride[];

  constructor(args: {
    readonly path: string;
    readonly root: string;
    readonly model: string;
    readonly filter: FileFilter;
    readonly rules: ReadonlyMap<string, CompiledRule>;
    readonly overrides: readonly CompiledOverride[];
  }) {
    this.path = args.path;
    this.root = args.root;
    this.model = args.model;
    this.filter = args.filter;
    this.rules = args.rules;
    this.overrides = args.overrides;
  }

  /**
   * Look up the override setting for `ruleId` applied to `file`. Returns
   * the **last** override whose file filter matches (later entries win),
   * then the matching setting within that override, or `undefined` if no
   * override applies.
   *
   * @param file Absolute path to the source file being linted.
   * @param ruleId The rule id (e.g. "function-simplicity").
   */
  async settingFor(
    file: string,
    ruleId: string,
  ): Promise<RuleSettingInput | undefined> {
    for (let i = this.overrides.length - 1; i >= 0; i--) {
      const ov = this.overrides[i];
      if (ov === undefined) continue;
      // Globs are anchored against `this.root`, mirroring how the project
      // filter is also relative to the config directory.
      if (await ov.filter.matches(file, this.root)) {
        if (Object.prototype.hasOwnProperty.call(ov.rules, ruleId)) {
          return ov.rules[ruleId];
        }
      }
    }
    return undefined;
  }
}

/**
 * Load a config from a path on disk, resolving `extends` and `rule_files`.
 * Throws `ConfigError` on any structural or semantic failure.
 */
export async function load(path: string): Promise<Config> {
  const absolute = await canonicalize(path);
  const merged = await mergeFromPath(absolute);
  return compile(merged, absolute);
}

/**
 * Discover the nearest config file starting at `start` (default:
 * `process.cwd()`), then load it.
 */
export async function loadFromDiscovery(start: string): Promise<Config> {
  const path = await discover(start);
  return load(path);
}

/**
 * Compile a merged config into a `Config` object. Run after merging and
 * before handing the config to the runner.
 */
export async function compile(
  merged: MergedConfig,
  configPath: string,
): Promise<Config> {
  // Validate cross-field rules.
  validateAllRules(merged.rules, configPath);
  validateOverrides(merged.rules, merged.overrides, configPath);

  // Compile rules with their per-rule file filters.
  const compiledRules = new Map<string, CompiledRule>();
  for (const [id, rule] of merged.rules.entries()) {
    compiledRules.set(id, {
      definition: rule,
      filter: new FileFilter(rule.where.files, rule.where.exclude),
    });
  }

  // Compile overrides.
  const compiledOverrides: CompiledOverride[] = [];
  for (const ov of merged.overrides) {
    compiledOverrides.push({
      files: ov.files,
      exclude: ov.exclude,
      rules: { ...ov.rules },
      filter: new FileFilter(ov.files, ov.exclude),
    });
  }

  // Apply defaults.
  const include = merged.include ?? [...DEFAULT_INCLUDE];
  const model = merged.model ?? DEFAULT_MODEL;
  const filter = new FileFilter(include, merged.exclude);

  if (compiledRules.size === 0) {
    throw new ConfigError(
      `configuration contains no rules; add at least one rule to ${configPath}`,
      configPath,
    );
  }

  return new Config({
    path: configPath,
    root: dirname(configPath),
    model,
    filter,
    rules: compiledRules,
    overrides: compiledOverrides,
  });
}

async function canonicalize(p: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  try {
    return await realpath(p);
  } catch (err) {
    throw new ConfigError(
      `cannot open config ${p}: ${(err as Error).message}`,
      p,
    );
  }
}
