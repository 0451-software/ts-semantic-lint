/**
 * `FileFilter` — include/exclude glob matcher backed by `tinyglobby`.
 *
 * Mirrors the role of ErisLint's `FileFilter` (which uses `globset`).
 * Always-excluded defaults (`node_modules`, `dist`, `.git`, `coverage`)
 * are layered on top of any explicit excludes — they cannot be opted into.
 */
import { dirname } from "node:path";
import { glob } from "tinyglobby";

/**
 * Directory names that are always excluded from any glob match, regardless
 * of user-supplied `include`/`exclude` patterns.
 */
export const ALWAYS_EXCLUDED: readonly string[] = Object.freeze([
  "node_modules",
  "dist",
  ".git",
  "coverage",
]);

/** tinyglobby options shared across the module. */
const GLOBBY_OPTIONS = {
  dot: false,
  absolute: true,
  onlyFiles: true,
  followSymbolicLinks: false,
} as const;

export class FileFilter {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** Absolute paths of always-excluded entries, pre-resolved for speed. */
  readonly alwaysExcluded: readonly string[];

  constructor(include: readonly string[], exclude: readonly string[]) {
    if (include.some((p) => p.length === 0)) {
      throw new ConfigError("file patterns must not be empty");
    }
    if (exclude.some((p) => p.length === 0)) {
      throw new ConfigError("exclude patterns must not be empty");
    }
    this.include = Object.freeze([...include]);
    this.exclude = Object.freeze([...exclude]);
    this.alwaysExcluded = Object.freeze([...ALWAYS_EXCLUDED]);
  }

  /**
   * Test whether `absolutePath` matches. The path must satisfy the include
   * globs (relative to `root`) and not match any of the exclude or
   * always-excluded globs.
   */
  async matches(absolutePath: string, root?: string): Promise<boolean> {
    if (this.isAlwaysExcluded(absolutePath)) {
      return false;
    }
    const cwd = root ?? dirname(absolutePath);
    if (this.exclude.length > 0) {
      const excluded = new Set(
        await glob(this.exclude, { ...GLOBBY_OPTIONS, cwd }),
      );
      if (excluded.has(absolutePath)) return false;
    }
    if (this.include.length === 0) {
      return true;
    }
    const included = await glob(this.include, { ...GLOBBY_OPTIONS, cwd });
    return included.includes(absolutePath);
  }

  /**
   * Expand the include globs against the given root directory and return
   * matching files, with the always-excluded paths filtered out.
   */
  async expand(root: string): Promise<string[]> {
    const included =
      this.include.length === 0
        ? await glob("**/*", { ...GLOBBY_OPTIONS, cwd: root })
        : await glob(this.include, { ...GLOBBY_OPTIONS, cwd: root });
    if (this.exclude.length === 0) {
      return included.filter((p) => !this.isAlwaysExcluded(p));
    }
    const excluded = new Set(
      await glob(this.exclude, { ...GLOBBY_OPTIONS, cwd: root }),
    );
    return included.filter(
      (p) => !excluded.has(p) && !this.isAlwaysExcluded(p),
    );
  }

  private isAlwaysExcluded(absolutePath: string): boolean {
    const parts = absolutePath.split("/");
    return this.alwaysExcluded.some((name) => parts.includes(name));
  }
}

/**
 * Common error type raised by the config module so callers can match with
 * `instanceof ConfigError` instead of relying on string matching.
 */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(
    message: string,
    readonly path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
  }
}
