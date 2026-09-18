/**
 * Mapping from typescript-estree node kinds to our internal `LintedTarget.kind`.
 *
 * Mirrors the behavioral map from ErisLint's `TargetKind::of` (rust.rs):
 *
 * | Rust SyntaxKind | ErisLint TargetKind | TS AST kind (this module)   | our `kind` |
 * |-----------------|---------------------|-----------------------------|------------|
 * | FN              | Function            | FunctionDeclaration / ArrowFunctionExpression / MethodDefinition | `function` |
 * | STRUCT          | Struct              | ClassDeclaration / ClassExpression                                | `class`    |
 * | ENUM            | Enum                | TSEnumDeclaration                                                | `enum`     |
 * | TRAIT           | Trait               | TSInterfaceDeclaration                                           | `interface` |
 * | (none)          | (n/a)               | TSTypeAliasDeclaration                                           | `type`     |
 * | MODULE          | Module              | TSModuleDeclaration                                              | `module`   |
 * | SOURCE_FILE     | File                | Program                                                          | `file`     |
 *
 * These internal strings are the canonical names; the actual typescript-estree
 * AST node kind is preserved in the per-target `kind` field of `LintedTarget`
 * for downstream consumers that care about the source-language specifics.
 */

/**
 * The set of typescript-estree AST node kinds we extract as `LintedTarget`s.
 *
 * Keep this aligned with the table above. Unknown kinds are ignored — we only
 * produce targets for nodes listed here.
 */
export const EXTRACTABLE_NODE_KINDS: ReadonlySet<string> = new Set<string>([
  "FunctionDeclaration",
  "ArrowFunctionExpression",
  "MethodDefinition",
  "TSDeclareFunction",
  "ClassDeclaration",
  "ClassExpression",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "Program",
]);

/** Internal canonical kind strings — what `LintedTarget.kind` will be set to. */
export type InternalKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "module"
  | "file";

/**
 * Map a typescript-estree node kind to the internal kind. Returns `undefined`
 * for kinds we don't extract.
 */
export function internalKindFor(astKind: string): InternalKind | undefined {
  switch (astKind) {
    case "FunctionDeclaration":
    case "ArrowFunctionExpression":
    case "MethodDefinition":
    case "TSDeclareFunction":
      return "function";
    case "ClassDeclaration":
    case "ClassExpression":
      return "class";
    case "TSInterfaceDeclaration":
      return "interface";
    case "TSTypeAliasDeclaration":
      return "type";
    case "TSEnumDeclaration":
      return "enum";
    case "TSModuleDeclaration":
      return "module";
    case "Program":
      return "file";
    default:
      return undefined;
  }
}

/**
 * Reverse map: internal kind → the typescript-estree AST node kinds we treat as
 * instances of it. Used by the analyzer's traversal filters.
 */
export const AST_KINDS_BY_INTERNAL: Readonly<Record<InternalKind, readonly string[]>> = {
  function: ["FunctionDeclaration", "ArrowFunctionExpression", "MethodDefinition", "TSDeclareFunction"],
  class: ["ClassDeclaration", "ClassExpression"],
  interface: ["TSInterfaceDeclaration"],
  type: ["TSTypeAliasDeclaration"],
  enum: ["TSEnumDeclaration"],
  module: ["TSModuleDeclaration"],
  file: ["Program"],
};

/**
 * Default name when a node has no extractable identifier.
 *
 * Mirrors the Rust default: `<unnamed>` for normal targets, with the file
 * target getting the path-derived name set by the caller.
 */
export const UNNAMED = "<unnamed>";
