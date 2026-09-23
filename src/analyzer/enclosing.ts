/**
 * Walk a node's ancestors and build the `LintedTarget.enclosing` list.
 *
 * Mirrors ErisLint's `enclosing` function: ancestors are filtered to the
 * kinds we extract, formatted into a compact `{ kind, name, ... }` record,
 * and returned outermost-first.
 */

import type { TSESTree } from "@typescript-eslint/typescript-estree";

import {
  AST_KINDS_BY_INTERNAL,
  type InternalKind,
  internalKindFor,
  UNNAMED,
} from "./kinds.js";
import { nameFor } from "./describe.js";

/**
 * The shape of a single enclosing-scope record. Matches the
 * `EnclosingScope` union from `src/types.ts` but is duplicated here to avoid
 * pulling that file in (which would couple the analyzer to the shared types
 * more tightly than necessary). Re-exported via the analyzer's index.
 */
export interface EnclosingEntry {
  readonly kind: "module" | "class" | "function" | "interface" | "type";
  readonly name?: string;
  readonly source?: string;
}

/**
 * Recursive ancestor walker. Skips the node itself (`node.ancestors()` in
 * Rust starts *above* the input node); we do the same by passing
 * `node.parent` as the starting point.
 *
 * Returns ancestors in inner-to-outer order. The caller reverses the list
 * to produce the outermost-first shape `LintedTarget.enclosing` expects.
 */
function collectAncestors(node: TSESTree.Node): readonly TSESTree.Node[] {
  const out: TSESTree.Node[] = [];
  let current: TSESTree.Node | undefined = node.parent;
  while (current) {
    out.push(current);
    current = current.parent;
  }
  return out;
}

/**
 * Format one enclosing-scope node into an `EnclosingEntry`. Returns
 * `undefined` if the node isn't a kind we care about for enclosing.
 *
 * The `file` (Program) kind is intentionally excluded — the Rust original
 * returns only Module / Function / Trait / Impl ancestors, never the file
 * scope itself.
 */
function describeEnclosing(
  node: TSESTree.Node,
  source: string,
): EnclosingEntry | undefined {
  const internal: InternalKind | undefined = internalKindFor(node.type);
  if (!internal) {
    return undefined;
  }
  if (internal === "file") {
    return undefined;
  }
  // We only emit the kinds the shared `EnclosingScope` union allows; modules
  // and file nodes are folded into `"module"` so the list stays small.
  let kind: EnclosingEntry["kind"];
  switch (internal) {
    case "module":
      kind = "module";
      break;
    case "class":
      kind = "class";
      break;
    case "function":
      kind = "function";
      break;
    case "interface":
      kind = "interface";
      break;
    case "type":
      kind = "type";
      break;
    case "enum":
      // `enum` is not in `EnclosingScope`; treat it as a module so a class
      // declared inside an enum still has a sane enclosing chain.
      kind = "module";
      break;
    default:
      return undefined;
  }
  const name = nameFor(node);
  const safeName = name && name !== UNNAMED ? name : undefined;
  const entry: {
    kind: EnclosingEntry["kind"];
    name?: string;
    source?: string;
  } = {
    kind,
    ...(safeName !== undefined ? { name: safeName } : {}),
  };
  if (source) {
    // Include a tiny snippet of the declaration (signature only) so Jev can
    // disambiguate overloaded / duplicate-named scopes without re-parsing
    // the whole source.
    const bodyRange = (node as { body?: { range?: readonly [number, number] } })
      .body?.range;
    const sigEnd = Array.isArray(bodyRange) ? bodyRange[0] : node.range[1];
    entry.source = source.slice(node.range[0], sigEnd);
  }
  return entry;
}

/**
 * Compute the `LintedTarget.enclosing` array for `node`. Returns an empty
 * array if the node is at the top of the file.
 *
 * Mirrors ErisLint's `enclosing` function: includes module / class / function
 * / interface / type ancestors, but excludes the file-level `Program` (the
 * Rust original returns Module / Function / Trait / Impl only).
 */
export function enclosingFor(
  node: TSESTree.Node,
  source: string,
): readonly EnclosingEntry[] {
  const ancestors = collectAncestors(node);
  const innerFirst: EnclosingEntry[] = [];
  for (const ancestor of ancestors) {
    const entry = describeEnclosing(ancestor, source);
    if (entry) {
      innerFirst.push(entry);
    }
  }
  // Reverse so outermost is first; matches Rust's `contexts.reverse()`.
  innerFirst.reverse();
  return innerFirst;
}

/**
 * Returns `true` if the kind is one we treat as "extracting" — i.e. one we
 * emit a `LintedTarget` for. Convenience wrapper around the
 * `EXTRACTABLE_NODE_KINDS` set from `./kinds.js`.
 */
export function isExtractableKind(node: TSESTree.Node): boolean {
  return internalKindFor(node.type) !== undefined;
}

/**
 * All AST node kinds we extract, as a flat array. Useful for callers that
 * want to feed these directly into a `descendants()` filter without
 * re-listing the constants.
 */
export const extractableNodeKinds: readonly string[] = [
  ...AST_KINDS_BY_INTERNAL.function,
  ...AST_KINDS_BY_INTERNAL.class,
  ...AST_KINDS_BY_INTERNAL.interface,
  ...AST_KINDS_BY_INTERNAL.type,
  ...AST_KINDS_BY_INTERNAL.enum,
  ...AST_KINDS_BY_INTERNAL.module,
  ...AST_KINDS_BY_INTERNAL.file,
];
