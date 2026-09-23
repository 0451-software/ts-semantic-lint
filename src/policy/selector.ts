/**
 * Selector matching — does this `Selector` describe this `LintedTarget`?
 *
 * All fields of `Selector` are ANDed. Any field that is `undefined` is a
 * wildcard and matches anything. The `namePattern` field is a JavaScript
 * regular expression (compiled via `new RegExp`); flags are not supported
 * — case-insensitivity can be expressed inline in the pattern itself.
 *
 * File globs use gitignore-style patterns. `files` matches when `target.file`
 * matches **any** pattern in the list; `exclude` matches when `target.file`
 * matches **none** of the listed patterns. (So `exclude: ["*starstar-slash-star.test.ts"]`
 * excludes any test file.)
 *
 * Implementation note: testing a single absolute path against a glob set is
 * done with the `ignore` package's `ignores(path)` API — it interprets
 * gitignore-style globs correctly per path. `tinyglobby` (already a project
 * dependency for the config layer's filesystem enumeration) walks the
 * filesystem and would force us to enumerate the entire project tree on
 * every selector match; `ignore` answers the same question in O(1) per
 * pattern.
 *
 * `hasBody` is read from the target via duck-typed access because
 * `LintedTarget` does not declare it; if the target doesn't expose the
 * field, it defaults to `false` (which is a sensible conservative default).
 */
import ignore from "ignore";
import * as path from "node:path";
import type { LintedTarget, Selector } from "../types.js";

// The `ignore` package is CommonJS and exposes a factory function directly.
// Under our ESM/NodeNext resolution, the default import gives us the factory.
// We rebuild it as a typed callable for clarity.
type IgnoreFactory = (options?: object) => IgnoreInstance;
interface IgnoreInstance {
  add(patterns: string | readonly string[]): IgnoreInstance;
  ignores(pathname: string): boolean;
}
const makeIgnore: IgnoreFactory = (ignore as unknown as IgnoreFactory).bind(
  ignore,
) as IgnoreFactory;

// Some `LintedTarget` shapes in the wider codebase expose `hasBody`; the
// shared type does not. Read defensively.
type HasBody = { hasBody?: boolean };

function hasBody(target: LintedTarget): boolean {
  const t = target as unknown as HasBody;
  return t.hasBody === true;
}

/**
 * `ignore` works on relative paths. Convert the absolute target.file to a
 * project-relative path by stripping leading `/`. This loses absolute-path
 * semantics but preserves path-segment matching — the only thing glob
 * patterns care about.
 */
function toTestablePath(absolutePath: string): string {
  return path.isAbsolute(absolutePath)
    ? absolutePath.replace(/^\/+/, "")
    : absolutePath;
}

/** Test if `absoluteFilePath` matches any of `patterns`. */
function matchesAnyGlob(
  absoluteFilePath: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  const tester = makeIgnore().add(patterns as string[]);
  const rel = toTestablePath(absoluteFilePath);
  // `ignores` returns true if the path is ignored (i.e. the patterns match).
  // For a positive `files` matcher this is what we want. For `exclude` we
  // use the same primitive but invert the meaning at the call site.
  return tester.ignores(rel);
}

function matchesSelectorNoFiles(
  selector: Selector,
  target: LintedTarget,
): boolean {
  if (selector.kind !== undefined && selector.kind !== target.kind) {
    return false;
  }
  if (selector.hasBody !== undefined && selector.hasBody !== hasBody(target)) {
    return false;
  }
  if (selector.name !== undefined && selector.name !== target.name) {
    return false;
  }
  if (selector.namePattern !== undefined) {
    if (target.name === undefined) return false;
    let re: RegExp;
    try {
      re = new RegExp(selector.namePattern);
    } catch {
      // Malformed pattern — fail closed (don't match).
      return false;
    }
    if (!re.test(target.name)) return false;
  }
  if (
    selector.visibility !== undefined &&
    selector.visibility !== target.visibility
  ) {
    return false;
  }
  return true;
}

/**
 * Selector matcher. Synchronous. All set fields are ANDed; `undefined` is
 * a wildcard. File globs are tested per-path with gitignore-style patterns.
 */
export function matchesSelector(
  selector: Selector,
  target: LintedTarget,
): boolean {
  if (!matchesSelectorNoFiles(selector, target)) return false;

  if (selector.files !== undefined) {
    if (!matchesAnyGlob(target.file, selector.files)) return false;
  }
  if (selector.exclude !== undefined) {
    if (matchesAnyGlob(target.file, selector.exclude)) return false;
  }
  return true;
}
