/**
 * Analyzer entry point — parse TypeScript source into `LintedTarget[]`.
 *
 * This is the AST extraction layer that replaces ErisLint's `src/rust.rs`
 * (Rust port, fresh MIT implementation). Given a source string and a file
 * path, we hand back one `LintedTarget` per extractable declaration.
 *
 * Usage:
 *
 * ```ts
 * import { extractTargets } from "./analyzer/index.js";
 *
 * const targets = extractTargets(sourceCode, "/abs/path/to/file.ts");
 * // → LintedTarget[]
 * ```
 *
 * See `./README.md` for the full API and `./analyzer.test.ts` for usage
 * examples.
 */

import {
  parse,
  simpleTraverse,
  TSError,
} from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";

import type { EnclosingScope, LintedTarget } from "../types.js";

import { describe, declarationStartFor, nameFor } from "./describe.js";
import { enclosingFor, type EnclosingEntry } from "./enclosing.js";
import {
  EXTRACTABLE_NODE_KINDS,
  type InternalKind,
  internalKindFor,
  UNNAMED,
} from "./kinds.js";
import { Lines, resolveRange } from "./positions.js";

/**
 * Options accepted by `extractTargets`.
 *
 * - `kinds` — limit the extracted node kinds. Defaults to all kinds we know
 *   about. Pass a smaller set to focus extraction (e.g. for a single rule).
 * - `fileText` — full file source. Defaults to `source` itself, which is the
 *   normal case when the caller hands us the file as a single string.
 */
export interface ExtractOptions {
  /**
   * Restrict extraction to a subset of the default kinds. Pass any subset of
   * `["function", "class", "interface", "type", "enum", "module", "file"]`.
   * When omitted, every extractable kind is returned.
   */
  readonly kinds?: ReadonlySet<InternalKind>;

  /**
   * Override the file-level source text. Defaults to `source` — provided so
   * callers can pass the original file contents even if the parsed `source`
   * was transformed (e.g. stripped of type-only imports).
   */
  readonly fileText?: string;

  /**
   * Parse-time options forwarded to `typescript-estree`. Defaults to the
   * module's defaults; supply a custom value to enable JSX / project-aware
   * parsing or to override `loc` / `range` flags.
   */
  readonly parseOptions?: Parameters<typeof parse>[1];
}

const DEFAULT_KINDS: ReadonlySet<InternalKind> = new Set<InternalKind>([
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "module",
  "file",
]);

const KIND_TO_AST: Readonly<Record<InternalKind, readonly string[]>> = {
  function: [
    "FunctionDeclaration",
    "TSDeclareFunction",
    "ArrowFunctionExpression",
    "MethodDefinition",
  ],
  class: ["ClassDeclaration", "ClassExpression"],
  interface: ["TSInterfaceDeclaration"],
  type: ["TSTypeAliasDeclaration"],
  enum: ["TSEnumDeclaration"],
  module: ["TSModuleDeclaration"],
  file: ["Program"],
};

/**
 * Public entry — parse `source`, walk it, return one `LintedTarget` per
 * extractable declaration.
 *
 * Throws `Error` if typescript-estree reports any syntax errors. The message
 * includes the line / column of every reported error.
 */
export function extractTargets(
  source: string,
  filePath: string,
  options?: ExtractOptions,
): LintedTarget[] {
  const parseOptions = options?.parseOptions ?? {
    comment: true,
    loc: true,
    range: true,
  };
  let ast: TSESTree.Program;
  try {
    ast = parse(source, parseOptions);
  } catch (error) {
    if (error instanceof TSError) {
      throw new SyntaxError(formatParseError(error));
    }
    throw error;
  }

  const kinds: ReadonlySet<InternalKind> = options?.kinds ?? DEFAULT_KINDS;
  const allowedAstKinds = kindsToAstSet(kinds);
  const lines = new Lines(source);
  const fileText = options?.fileText ?? source;

  // Wire leading JSDoc comments onto the nodes they precede so per-target
  // `docs` collection works. typescript-estree leaves comments in
  // `ast.comments`; we attach them ourselves.
  const astBag = ast as { comments?: ReadonlyArray<TSESTree.Comment> };
  attachLeadingComments(ast, astBag.comments);

  const out: LintedTarget[] = [];

  simpleTraverse(
    ast,
    {
      enter(node) {
        if (!allowedAstKinds.has(node.type)) {
          return;
        }
        const target = nodeToTarget(node, source, fileText, filePath, lines);
        if (target) {
          out.push(target);
        }
      },
    },
    // setParentPointers=true so `nodeToTarget` (and `nameFor`, `enclosingFor`)
    // can resolve parent names like `const foo = () => {}`.
    true,
  );

  return out;
}

/**
 * Render a typescript-estree `TSError` into a single-line message with line
 * and column numbers, for inclusion in the `SyntaxError` thrown to callers.
 */
function formatParseError(error: TSError): string {
  const location = (
    error as { location?: { start?: { line?: number; column?: number } } }
  ).location;
  const start = location?.start;
  const where =
    start?.line !== undefined && start.column !== undefined
      ? `at line ${start.line}, column ${start.column}`
      : "";
  return `TypeScript syntax error${where ? ` ${where}` : ""}: ${error.message}`;
}

/**
 * Convert a set of internal kinds back into the set of typescript-estree node
 * kinds that correspond to them.
 */
function kindsToAstSet(kinds: ReadonlySet<InternalKind>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const kind of kinds) {
    for (const ast of KIND_TO_AST[kind]) {
      out.add(ast);
    }
  }
  return out;
}

/**
 * Iterative depth-first walk over a typescript-estree node tree.
 *
 * `typescript-estree` doesn't expose a `descendants()` helper (unlike
 * `ra_ap_syntax`), so we implement a small iterative walker ourselves. This
 * avoids recursion-depth explosions on large / deeply-nested files.
 */
function walk(root: TSESTree.Node, visit: (node: TSESTree.Node) => void): void {
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    visit(node);
    const bag = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(bag)) {
      const value = bag[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) {
            stack.push(item as TSESTree.Node);
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        stack.push(value as TSESTree.Node);
      }
    }
  }
}

/**
 * Attach leading JSDoc-style block comments to each extractable node.
 *
 * `typescript-estree` collects comments in `ast.comments` but does not wire
 * them onto the nodes themselves; we do that here so `LintedTarget.docs` can
 * be populated. A comment "leads" a node when the comment's range ends at or
 * just before the node's start range.
 */
function attachLeadingComments(
  ast: TSESTree.Program,
  comments: ReadonlyArray<TSESTree.Comment> | undefined,
): void {
  if (!comments || comments.length === 0) {
    return;
  }
  const ordered = [...comments].sort((a, b) => a.range[0] - b.range[0]);
  const nodes: TSESTree.Node[] = [];
  walk(ast, (node) => {
    nodes.push(node);
  });
  nodes.sort((a, b) => a.range[0] - b.range[0]);

  // Two-pointer walk: for each comment, advance `nodeIdx` past any node
  // whose start is before the comment's end. The first remaining node is the
  // one that the comment leads.
  let nodeIdx = 0;
  for (const comment of ordered) {
    while (
      nodeIdx < nodes.length &&
      (nodes[nodeIdx]?.range[0] ?? Number.POSITIVE_INFINITY) < comment.range[1]
    ) {
      nodeIdx++;
    }
    const target = nodes[nodeIdx];
    if (!target) {
      continue;
    }
    if (comment.type !== "Block" || !comment.value.startsWith("*")) {
      continue;
    }
    const bag = target as unknown as { leadingComments?: TSESTree.Comment[] };
    if (!bag.leadingComments) {
      bag.leadingComments = [];
    }
    bag.leadingComments.push(comment);
  }
}

/**
 * Map one typescript-estree node to a `LintedTarget`. Returns `undefined`
 * for kinds we don't extract (the caller should pre-filter).
 */
function nodeToTarget(
  node: TSESTree.Node,
  source: string,
  fileText: string,
  filePath: string,
  lines: Lines,
): LintedTarget | undefined {
  const internal = internalKindFor(node.type);
  if (!internal) {
    return undefined;
  }
  const expandedRange = expandRangeToModifiers(node);
  const resolved = resolveRange(lines, expandedRange);
  const snippet = source.slice(expandedRange[0], expandedRange[1]);
  const name = nameFor(node) ?? (internal === "file" ? filePath : UNNAMED);
  const visibility = readVisibility(node);
  const enclosing = enclosingFor(node, source);
  const state = describe(node, source);
  const decStart = declarationStartFor(node);
  const declarationPos = lines.position(decStart.offset);

  const attributes = readAttributes(node, source);
  const docs = readDocs(node, source);
  const generics = readGenerics(node, source);

  const target: MutableTarget = {
    kind: internal,
    file: filePath,
    fileText,
    range: resolved,
    snippet,
    attributes,
    docs,
    visibility,
    enclosing: toEnclosingScope(enclosing),
    appliedRules: [],
  };
  if (name !== UNNAMED) {
    target.name = name;
  }
  target.declarationStart = {
    line: declarationPos.line,
    column: declarationPos.column,
    offset: decStart.offset,
  };
  if (generics !== undefined) {
    target.generics = generics;
  }
  // Set `hasBody` on function-like targets so the matcher can filter by
  // `where: { has_body: true }`. The convention is `true` for any node
  // whose AST carries a non-null `body` (function declarations,
  // arrow functions, methods); `false` for ambient declarations
  // (`TSDeclareFunction`) and other body-less constructs.
  target.hasBody = readHasBody(node);
  // The `state` field is the rich JSON payload we send to Jev. It is not
  // part of `LintedTarget` directly, so we attach it as a custom field via
  // a type assertion. Consumers that want it can read `target.state as
  // Record<string, unknown>`.
  (target as { state?: unknown }).state = state;
  return target as unknown as LintedTarget;
}

/**
 * Read whether the AST node carries a non-null `body`. Covers every
 * function-shaped node in typescript-estree (FunctionDeclaration,
 * FunctionExpression, ArrowFunctionExpression, MethodDefinition,
 * TSDeclareFunction). Non-function nodes fall through to `false`.
 */
function readHasBody(node: TSESTree.Node): boolean {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "MethodDefinition":
    case "TSDeclareFunction":
      return (node as unknown as { body?: unknown }).body != null;
    default:
      return false;
  }
}

/**
 * Walk up the AST to expand a node's range to include leading modifiers
 * like `export`, `export default`, `declare`, etc. so the emitted `snippet`
 * and `range` cover the full declaration a user sees in source.
 */
function expandRangeToModifiers(
  node: TSESTree.Node,
): readonly [number, number] {
  let start = node.range[0];
  let end = node.range[1];
  const parent = node.parent;
  if (parent) {
    if (
      parent.type === "ExportNamedDeclaration" &&
      parent.declaration === node
    ) {
      start = Math.min(start, parent.range[0]);
      end = Math.max(end, parent.range[1]);
    } else if (
      parent.type === "ExportDefaultDeclaration" &&
      parent.declaration === node
    ) {
      start = Math.min(start, parent.range[0]);
      end = Math.max(end, parent.range[1]);
    }
  }
  return [start, end] as const;
}

/**
 * Read the `accessibility` modifier from a node, falling back to `"public"`.
 */
function readVisibility(
  node: TSESTree.Node,
): "public" | "private" | "protected" {
  const candidate = node as { accessibility?: unknown };
  if (
    candidate.accessibility === "private" ||
    candidate.accessibility === "protected"
  ) {
    return candidate.accessibility;
  }
  return "public";
}

/**
 * Read `@Decorator` source spans from a node, if any. Empty array when none.
 */
function readAttributes(
  node: TSESTree.Node,
  source: string,
): readonly string[] {
  const candidate = node as {
    decorators?: ReadonlyArray<{ expression: TSESTree.Node }>;
  };
  const decorators = candidate.decorators;
  if (!decorators || decorators.length === 0) {
    return [];
  }
  const out: string[] = [];
  for (const d of decorators) {
    out.push(source.slice(d.expression.range[0], d.expression.range[1]));
  }
  return out;
}

/**
 * Read leading JSDoc-style block comments for a node.
 *
 * Strategy: typescript-estree with `comment: true` populates `ast.comments`
 * (the global list) but does not attach comments to specific nodes. We
 * therefore resolve the doc by finding the closest preceding JSDoc-shaped
 * block comment whose end-offset is the largest offset still ≤ the node's
 * start, allowing for whitespace between them.
 *
 * "JSDoc-shaped" = block comment whose body starts with `*` (the second
 * character after `/*`). Plain block comments are excluded.
 */
function readDocs(node: TSESTree.Node, source: string): readonly string[] {
  const ast = findProgram(node);
  if (!ast || !ast.comments) {
    return [];
  }
  const targetStart = node.range[0];
  let best: TSESTree.Comment | undefined;
  let bestEnd = -1;
  for (const c of ast.comments) {
    if (c.type !== "Block") continue;
    if (!c.value.startsWith("*")) continue;
    const endOffset = c.range[1];
    if (endOffset <= targetStart && endOffset > bestEnd) {
      best = c;
      bestEnd = endOffset;
    }
  }
  if (!best) {
    return [];
  }
  return [source.slice(best.range[0], best.range[1])];
}

/**
 * Walk up to the root `Program` node.
 */
function findProgram(node: TSESTree.Node): TSESTree.Program | undefined {
  let current: TSESTree.Node | undefined = node;
  while (current) {
    if (current.type === "Program") {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Read the `<T, U extends Foo>` source text from a node, if any.
 */
function readGenerics(node: TSESTree.Node, source: string): string | undefined {
  const candidate = node as { typeParameters?: TSESTree.Node | undefined };
  const params = candidate.typeParameters;
  if (!params) {
    return undefined;
  }
  return source.slice(params.range[0], params.range[1]);
}

/**
 * Narrow an `EnclosingEntry` array into the `EnclosingScope` discriminated
 * union that `LintedTarget.enclosing` expects.
 */
function toEnclosingScope(
  entries: readonly EnclosingEntry[],
): readonly EnclosingScope[] {
  const out: EnclosingScope[] = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case "module":
        out.push(
          entry.name
            ? { kind: "module", name: entry.name }
            : { kind: "module" },
        );
        break;
      case "class":
        out.push(
          entry.name ? { kind: "class", name: entry.name } : { kind: "class" },
        );
        break;
      case "function":
        out.push(
          entry.name
            ? { kind: "function", name: entry.name }
            : { kind: "function" },
        );
        break;
      case "interface":
        out.push(
          entry.name
            ? { kind: "interface", name: entry.name }
            : { kind: "interface" },
        );
        break;
      case "type":
        out.push(
          entry.name ? { kind: "type", name: entry.name } : { kind: "type" },
        );
        break;
    }
  }
  return out;
}

/**
 * Internal mutable mirror of `LintedTarget`, used while building each
 * target. Optional fields are filled in only when populated.
 */
interface MutableTarget {
  kind: string;
  file: string;
  fileText: string;
  range: LintedTarget["range"];
  snippet: string;
  attributes: readonly string[];
  docs: readonly string[];
  visibility: "public" | "private" | "protected";
  enclosing: readonly EnclosingScope[];
  appliedRules: readonly never[];
  name?: string;
  declarationStart?: LintedTarget["declarationStart"];
  generics?: string;
  whereClause?: string;
  hasBody?: boolean;
}

// Re-exports so consumers can import the analyzer's pieces from a single
// entry point.
export { EXTRACTABLE_NODE_KINDS, internalKindFor, UNNAMED } from "./kinds.js";

export { nameFor, describe, declarationStartFor } from "./describe.js";
export { enclosingFor } from "./enclosing.js";
export { Lines, resolveRange } from "./positions.js";

export type { EnclosingEntry } from "./enclosing.js";
export type { InternalKind } from "./kinds.js";
