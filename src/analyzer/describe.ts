/**
 * Produce the rich "state" object we attach to each `LintedTarget`.
 *
 * Mirrors the `describe` + `common` + `fields` helpers from
 * `ErisLint/src/rust.rs` but adapted for typescript-estree:
 *
 * - `describe` dispatches on node type and fills in type-specific fields.
 * - `common` extracts the fields every kind carries (name, generics,
 *   attributes, docs, visibility, etc.).
 * - The output is a plain `Record<string, unknown>` so callers can serialize
 *   it to JSON without losing information.
 */

import type { TSESTree } from "@typescript-eslint/typescript-estree";

import { UNNAMED } from "./kinds.js";

/**
 * Snip a substring out of the source between two byte offsets.
 */
function sliceSource(
  source: string,
  start: number,
  end: number,
): string | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return undefined;
  }
  return source.slice(start, end);
}

/**
 * Slice text from `source` covering a node's `[start, end)` range. Returns
 * `undefined` if either bound is non-finite (e.g. for synthetic nodes).
 */
function sliceRange(source: string, range: readonly [number, number]): string {
  const safeStart = Number.isFinite(range[0]) ? range[0] : 0;
  const safeEnd = Number.isFinite(range[1]) ? range[1] : safeStart;
  return source.slice(safeStart, safeEnd);
}

/**
 * Type guard: a node carries a `decorators` array (true for most node kinds
 * that can be decorated in TS / TSX).
 */
function hasDecorators(node: TSESTree.Node): node is TSESTree.Node & {
  decorators: ReadonlyArray<TSESTree.Decorator>;
} {
  return "decorators" in node && Array.isArray((node as { decorators?: unknown }).decorators);
}

/**
 * Type guard: a node carries `leadingComments` (set when typescript-estree
 * parses with `comment: true`, which our default does).
 */
function hasLeadingComments(
  node: TSESTree.Node,
): node is TSESTree.Node & { leadingComments: ReadonlyArray<TSESTree.Comment> } {
  return (
    "leadingComments" in node &&
    Array.isArray((node as { leadingComments?: unknown }).leadingComments)
  );
}

/**
 * Type guard: `TSTypeParameterDeclaration` attached to a function / class /
 * type / interface.
 */
function hasTypeParameters(
  node: TSESTree.Node,
): node is TSESTree.Node & { typeParameters: TSESTree.TSTypeParameterDeclaration } {
  const candidate = node as { typeParameters?: unknown };
  return (
    candidate.typeParameters !== undefined &&
    candidate.typeParameters !== null &&
    typeof candidate.typeParameters === "object" &&
    (candidate.typeParameters as { type?: string }).type === "TSTypeParameterDeclaration"
  );
}

/**
 * Type guard: a `returnType` annotation on a function-like node.
 */
function hasReturnType(
  node: TSESTree.Node,
): node is TSESTree.Node & { returnType: TSESTree.TSTypeAnnotation } {
  const candidate = node as { returnType?: unknown };
  return (
    candidate.returnType !== undefined &&
    candidate.returnType !== null &&
    typeof candidate.returnType === "object" &&
    (candidate.returnType as { type?: string }).type === "TSTypeAnnotation"
  );
}

/**
 * Return a stable text identifier for `node`, falling back to `undefined`
 * when no name is available.
 */
export function nameFor(node: TSESTree.Node): string | undefined {
  switch (node.type) {
    case "FunctionDeclaration":
    case "TSDeclareFunction":
    case "ClassDeclaration":
    case "ClassExpression":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSModuleDeclaration": {
      const id = (node as { id?: TSESTree.Node | null }).id;
      if (id && id.type === "Identifier") {
        return id.name;
      }
      return undefined;
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      // The function itself rarely has a name; walk to the variable declarator
      // parent when possible.
      const parent = node.parent;
      if (parent && parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
        return parent.id.name;
      }
      return undefined;
    }
    case "MethodDefinition": {
      const method = node as TSESTree.MethodDefinition;
      const key = method.key;
      if (key.type === "Identifier") {
        return key.name;
      }
      if (key.type === "Literal") {
        return String(key.value);
      }
      return undefined;
    }
    case "Program":
      return "<file>";
    default:
      return undefined;
  }
}

/**
 * Extract `@Decorator` source strings from a node, if it has any.
 *
 * Returns an empty array (not `undefined`) so consumers can rely on the
 * `attributes` field being a list. Each entry is the literal source span of
 * the decorator expression — e.g. `"@Inject"` or `"@Component({...})"`.
 */
function collectAttributes(node: TSESTree.Node, source: string): string[] {
  if (!hasDecorators(node)) {
    return [];
  }
  const decorators = node.decorators;
  if (decorators.length === 0) {
    return [];
  }
  const out: string[] = [];
  for (const decorator of decorators) {
    const expression = decorator.expression;
    out.push(sliceSource(source, expression.range[0], expression.range[1]) ?? "");
  }
  return out;
}

/**
 * Collect JSDoc-style block comments (those whose body starts with `*`)
 * that immediately precede the node. typescript-estree attaches them as
 * `leadingComments`; we filter to block comments matching the JSDoc shape.
 */
function collectDocs(node: TSESTree.Node, source: string): string[] {
  if (!hasLeadingComments(node)) {
    return [];
  }
  const docs: string[] = [];
  for (const comment of node.leadingComments) {
    if (comment.type !== "Block") {
      continue;
    }
    // JSDoc block comments start with an extra `*` immediately after the
    // opening `/*`, so they look like `* foo`. Bare block comments (`/ foo`)
    // are excluded.
    if (!comment.value.startsWith("*")) {
      continue;
    }
    docs.push(sliceSource(source, comment.range[0], comment.range[1]) ?? "");
  }
  return docs;
}

/**
 * Determine the visibility modifier for a node. Defaults to `"public"` to
 * match Rust's default.
 */
function visibilityFor(node: TSESTree.Node): "public" | "private" | "protected" {
  const candidate = node as { accessibility?: unknown };
  if (candidate.accessibility === "private" || candidate.accessibility === "protected") {
    return candidate.accessibility;
  }
  return "public";
}

/**
 * Extract the text of a `TSTypeParameterDeclaration` if present on the node.
 */
function genericsText(
  node: TSESTree.Node,
  source: string,
): string | undefined {
  if (!hasTypeParameters(node)) {
    return undefined;
  }
  return sliceRange(source, node.typeParameters.range);
}

/**
 * Common `state` fields — present on every kind of target.
 */
function commonState(node: TSESTree.Node, source: string): Record<string, unknown> {
  return {
    name: nameFor(node) ?? null,
    generics: genericsText(node, source) ?? null,
    attributes: collectAttributes(node, source),
    docs: collectDocs(node, source),
    visibility: visibilityFor(node),
  };
}

/**
 * Pretty modifier flags (`static`, `readonly`, `async`, etc.) on the node.
 */
function modifierFlags(node: TSESTree.Node): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const flags = ["static", "readonly", "abstract", "override", "declare"] as const;
  const bag = node as unknown as Record<string, unknown>;
  for (const flag of flags) {
    if (bag[flag] === true) {
      out[flag] = true;
    }
  }
  if (bag["async"] === true) {
    out["async"] = true;
  }
  if (bag["generator"] === true) {
    out["generator"] = true;
  }
  return out;
}

/**
 * Format the parameters of a function / method as a small JSON-serializable
 * list — pattern + type — matching the Rust `state.params` shape.
 *
 * The `type` field is the *inner* type expression, not the surrounding
 * `: type` annotation. `typescript-estree` exposes both: the outer
 * `TSTypeAnnotation` includes the leading colon, while its `typeAnnotation`
 * child is the bare type reference.
 */
function formatParams(
  params: ReadonlyArray<TSESTree.Parameter>,
  source: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const param of params) {
    const outerAnnotation = (param as { typeAnnotation?: TSESTree.TSTypeAnnotation | null })
      .typeAnnotation;
    const innerType = outerAnnotation?.typeAnnotation;
    out.push({
      pattern: sliceRange(source, param.range),
      type: innerType ? sliceRange(source, innerType.range) : null,
    });
  }
  return out;
}

/**
 * Build the "state" object that we attach to each `LintedTarget`.
 *
 * This is the data we ultimately serialize and send to Jev: the snippet,
 * parameters, return type, body, modifiers, etc. Different node types get
 * different fields; everything has at least `name`, `kind`, `language`.
 *
 * The returned object is a plain JSON-serializable record; nested values
 * must be JSON-safe (strings, numbers, booleans, arrays, objects, null).
 */
export function describe(node: TSESTree.Node, source: string): Record<string, unknown> {
  const base = commonState(node, source);
  const mods = modifierFlags(node);

  switch (node.type) {
    case "TSDeclareFunction": {
      // `declare function foo(x: number): number;` — declaration with no
      // body. We expose signature params and the (missing) body so callers
      // can tell this is an ambient declaration.
      const decl = node;
      const params = decl.params ? formatParams(decl.params, source) : [];
      const returnType = decl.returnType ? sliceRange(source, decl.returnType.range) : null;
      return {
        ...base,
        params,
        returnType,
        body: null,
        signature: sliceRange(source, decl.range),
        declare: true,
      };
    }
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const fn = node;
      const params = formatParams(fn.params, source);
      const outerReturn = hasReturnType(fn) ? fn.returnType : null;
      const innerReturn = outerReturn?.typeAnnotation ?? null;
      const returnType = innerReturn ? sliceRange(source, innerReturn.range) : null;
      const bodyRange = "body" in fn && fn.body ? fn.body.range : null;
      const body = bodyRange ? sliceRange(source, bodyRange) : null;
      const signature = bodyRange
        ? sliceRange(source, [fn.range[0], bodyRange[0]])
        : sliceRange(source, fn.range);
      return {
        ...base,
        params,
        returnType,
        body,
        signature,
        ...(mods.async !== undefined ? { async: mods.async } : {}),
        ...(mods.generator !== undefined ? { generator: mods.generator } : {}),
        ...(mods.declare !== undefined ? { declare: mods.declare } : {}),
      };
    }
    case "MethodDefinition": {
      const method = node;
      const value = method.value;
      let params: Array<Record<string, unknown>> = [];
      let returnType: string | null = null;
      let body: string | null = null;
      if (value.type === "FunctionExpression") {
        params = formatParams(value.params, source);
        const outerRet = value.returnType;
        const innerRet = outerRet?.typeAnnotation ?? null;
        if (innerRet) {
          returnType = sliceRange(source, innerRet.range);
        }
        if (value.body) {
          body = sliceRange(source, value.body.range);
        }
      }
      return {
        ...base,
        params,
        returnType,
        body,
        kind: method.kind,
        computed: method.computed,
        ...(mods.static !== undefined ? { static: mods.static } : {}),
        ...(mods.override !== undefined ? { override: mods.override } : {}),
      };
    }
    case "ClassDeclaration":
    case "ClassExpression": {
      const cls = node;
      const fields: Array<Record<string, unknown>> = [];
      const methods: Array<Record<string, unknown>> = [];
      for (const member of cls.body.body) {
        if (member.type === "PropertyDefinition") {
          const outerTypeAnnotation = member.typeAnnotation;
          const innerTypeAnnotation = outerTypeAnnotation?.typeAnnotation ?? null;
          fields.push({
            name:
              member.key.type === "Identifier"
                ? member.key.name
                : member.key.type === "Literal"
                  ? String(member.key.value)
                  : sliceRange(source, member.key.range),
            type: innerTypeAnnotation ? sliceRange(source, innerTypeAnnotation.range) : null,
            static: member.static,
            readonly: member.readonly,
            visibility: (member.accessibility ?? "public") as string,
          });
        } else if (
          member.type === "MethodDefinition" ||
          member.type === "TSAbstractMethodDefinition"
        ) {
          methods.push({ snippet: sliceRange(source, member.range) });
        }
      }
      const heritage: Array<Record<string, unknown>> = [];
      if (cls.superClass) {
        heritage.push({
          kind: "extends",
          type: sliceRange(source, cls.superClass.range),
        });
      }
      if (cls.implements) {
        for (const impl of cls.implements) {
          heritage.push({
            kind: "implements",
            type: sliceRange(source, impl.range),
          });
        }
      }
      return {
        ...base,
        heritage,
        fields,
        methods,
        ...(mods.abstract !== undefined ? { abstract: mods.abstract } : {}),
      };
    }
    case "TSInterfaceDeclaration": {
      const iface = node;
      const members: string[] = [];
      for (const member of iface.body.body) {
        members.push(sliceRange(source, member.range));
      }
      const heritage: string[] = [];
      if (iface.extends) {
        for (const ext of iface.extends) {
          heritage.push(sliceRange(source, ext.range));
        }
      }
      return {
        ...base,
        heritage,
        members,
      };
    }
    case "TSTypeAliasDeclaration": {
      const alias = node;
      return {
        ...base,
        aliased: sliceRange(source, alias.typeAnnotation.range),
      };
    }
    case "TSEnumDeclaration": {
      const enm = node;
      const variants: Array<Record<string, unknown>> = [];
      for (const member of enm.members) {
        variants.push({
          name:
            member.id.type === "Identifier"
              ? member.id.name
              : sliceRange(source, member.id.range),
          initializer: member.initializer
            ? sliceRange(source, member.initializer.range)
            : null,
        });
      }
      return {
        ...base,
        variants,
        ...(enm.const === true ? { const: true } : {}),
      };
    }
    case "TSModuleDeclaration": {
      const mod = node;
      const body = mod.body;
      const contents = body && body.type === "TSModuleBlock" ? sliceRange(source, body.range) : null;
      return {
        ...base,
        external: body === null,
        contents,
        ...(mod.declare === true ? { declaration: true } : {}),
      };
    }
    case "Program": {
      const topLevel: string[] = [];
      for (const stmt of node.body) {
        topLevel.push(sliceRange(source, stmt.range));
      }
      return {
        ...base,
        name: nameFor(node) ?? UNNAMED,
        contents: source,
        topLevel,
      };
    }
    default:
      return base;
  }
}

/**
 * Best-effort fallback name for a node, used when `LintedTarget.name` is
 * required but `nameFor` returns undefined. Kept exported for callers that
 * want a single source of "what should we call this?".
 */
export function displayName(node: TSESTree.Node): string {
  return nameFor(node) ?? UNNAMED;
}

/**
 * The "declaration start" for a node — the byte offset where the
 * declaration begins (e.g. the `function` / `class` / `interface` keyword).
 *
 * For most kinds this is the start of the node itself; for
 * `ArrowFunctionExpression` we keep the start of the arrow.
 */
export function declarationStartFor(
  node: TSESTree.Node,
): { readonly offset: number; readonly line: number; readonly column: number } {
  return { offset: node.range[0], line: -1, column: -1 };
}
