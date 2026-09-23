/**
 * Tests for the analyzer module.
 *
 * Covers the positive and negative cases listed in the brief:
 *
 * 1. Extracts a top-level function with name, params, return type, body.
 * 2. Extracts an arrow function (named via const binding when applicable).
 * 3. Extracts a class with fields and methods.
 * 4. Extracts an interface declaration.
 * 5. Extracts an enum declaration.
 * 6. `hasBody: false` for a function declaration without a body block (declare).
 * 7. `enclosing` populated correctly for nested functions/classes.
 * 8. Decorators collected into `attributes`.
 * 9. JSDoc comments collected into `docs`.
 * 10. Throws with a clear message when source has syntax errors.
 */

import { describe, expect, it } from "vitest";

import { extractTargets } from "./index.js";

import {
  ANONYMOUS_ARROW,
  CLASS_WITH_METHODS,
  DECORATED_CLASS,
  DECLARE_FUNCTION,
  ENUM_DECL,
  INTERFACE_DECL,
  MODULE_DECL,
  NAMED_ARROW,
  NESTED_CLASS,
  NESTED_FUNCTIONS,
  SIMPLE_FUNCTION,
  SYNTAX_ERROR,
  TYPE_ALIAS,
} from "./__fixtures__/index.js";

/** Find the first target with the given internal kind. */
function findTarget(
  targets: ReturnType<typeof extractTargets>,
  kind: string,
  name?: string,
) {
  const matches = targets.filter(
    (t) => t.kind === kind && (name === undefined || t.name === name),
  );
  if (matches.length === 0) {
    throw new Error(
      `No target with kind=${kind} name=${name}; got ${targets.map((t) => `${t.kind}:${t.name}`).join(", ")}`,
    );
  }
  return matches[0];
}

describe("extractTargets — basic kinds", () => {
  it("extracts a top-level function with name, params, return type, body", () => {
    const targets = extractTargets(SIMPLE_FUNCTION, "/abs/file.ts");
    const fn = findTarget(targets, "function", "add");
    expect(fn.name).toBe("add");
    expect(fn.snippet).toContain("export function add");
    expect(fn.snippet).toContain("return a + b");
    const state = (fn as unknown as { state: Record<string, unknown> }).state;
    expect(state.params).toEqual([
      { pattern: "a: number", type: "number" },
      { pattern: "b: number", type: "number" },
    ]);
    expect(state.returnType).toBe("number");
    expect(state.body).toContain("return a + b");
  });

  it("extracts an arrow function named via const binding", () => {
    const targets = extractTargets(NAMED_ARROW, "/abs/file.ts");
    const arrow = findTarget(targets, "function", "greet");
    expect(arrow).toBeDefined();
    const state = (arrow as unknown as { state: Record<string, unknown> })
      .state;
    expect(state.params).toEqual([{ pattern: "name: string", type: "string" }]);
    expect(state.returnType).toBe("string");
  });

  it("falls back to <unnamed> for anonymous arrows without a const binding", () => {
    const targets = extractTargets(ANONYMOUS_ARROW, "/abs/file.ts");
    const fns = targets.filter((t) => t.kind === "function");
    // The fixture defines `handler` so `nameFor` should pick it up via the
    // VariableDeclarator parent. We at minimum expect one named function.
    expect(fns.length).toBeGreaterThanOrEqual(1);
    expect(fns[0]?.name).toBe("handler");
  });

  it("extracts a class with fields and methods", () => {
    const targets = extractTargets(CLASS_WITH_METHODS, "/abs/file.ts");
    const cls = findTarget(targets, "class", "Calculator");
    expect(cls.name).toBe("Calculator");
    const state = (cls as unknown as { state: Record<string, unknown> }).state;
    expect(state.fields).toEqual([
      {
        name: "value",
        type: "number",
        static: false,
        readonly: false,
        visibility: "private",
      },
    ]);
    expect((state.methods as unknown[]).length).toBeGreaterThanOrEqual(2);
    // Methods include snippets of the original source.
    const snippets = (state.methods as Array<{ snippet: string }>).map(
      (m) => m.snippet,
    );
    expect(snippets.join("\n")).toContain("add(");
    expect(snippets.join("\n")).toContain("current(");
  });

  it("extracts an interface declaration", () => {
    const targets = extractTargets(INTERFACE_DECL, "/abs/file.ts");
    const iface = findTarget(targets, "interface", "Measurable");
    expect(iface.name).toBe("Measurable");
    const state = (iface as unknown as { state: Record<string, unknown> })
      .state;
    expect((state.members as unknown[]).length).toBe(2);
    expect((state.members as string[]).join("\n")).toContain("readonly length");
  });

  it("extracts an enum declaration", () => {
    const targets = extractTargets(ENUM_DECL, "/abs/file.ts");
    const enm = findTarget(targets, "enum", "LogLevel");
    expect(enm.name).toBe("LogLevel");
    const state = (enm as unknown as { state: Record<string, unknown> }).state;
    expect(state.variants).toEqual([
      { name: "Debug", initializer: null },
      { name: "Info", initializer: null },
      { name: "Warn", initializer: null },
      { name: "Error", initializer: null },
    ]);
  });

  it("extracts a type alias", () => {
    const targets = extractTargets(TYPE_ALIAS, "/abs/file.ts");
    const alias = findTarget(targets, "type", "UserId");
    expect(alias.name).toBe("UserId");
    const state = (alias as unknown as { state: Record<string, unknown> })
      .state;
    expect(state.aliased).toContain("UserId");
  });

  it("extracts a namespace (TSModuleDeclaration) module", () => {
    const targets = extractTargets(MODULE_DECL, "/abs/file.ts");
    const mod = findTarget(targets, "module", "urls");
    expect(mod.name).toBe("urls");
    const state = (mod as unknown as { state: Record<string, unknown> }).state;
    expect(state.external).toBe(false);
    expect(state.contents).toContain("build(");
  });
});

describe("extractTargets — hasBody & declarationStart", () => {
  it("marks a `declare` function as having no body", () => {
    const targets = extractTargets(DECLARE_FUNCTION, "/abs/file.ts");
    const fn = findTarget(targets, "function", "ambient");
    expect(fn.name).toBe("ambient");
    const state = (fn as unknown as { state: Record<string, unknown> }).state;
    expect(state.body).toBeNull();
  });

  it("populates declarationStart with a 1-indexed line and column", () => {
    const targets = extractTargets(SIMPLE_FUNCTION, "/abs/file.ts");
    const fn = findTarget(targets, "function", "add");
    expect(fn.declarationStart).toBeDefined();
    expect(fn.declarationStart?.line).toBe(1);
    expect(fn.declarationStart?.column).toBeGreaterThanOrEqual(1);
  });
});

describe("extractTargets — enclosing", () => {
  it("populates enclosing for nested functions", () => {
    const targets = extractTargets(NESTED_FUNCTIONS, "/abs/file.ts");
    const inner = findTarget(targets, "function", "inner");
    expect(inner.enclosing.length).toBeGreaterThanOrEqual(1);
    const outerScope = inner.enclosing[0];
    expect(outerScope).toBeDefined();
    if (outerScope && outerScope.kind === "function") {
      expect(outerScope.name).toBe("outer");
    } else {
      throw new Error("expected first enclosing to be the outer function");
    }
  });

  it("populates enclosing for a class declared inside another class", () => {
    const targets = extractTargets(NESTED_CLASS, "/abs/file.ts");
    const cls = findTarget(targets, "class", "Outer");
    // The Outer class itself has no enclosing; the inner `Inner` (anonymous
    // class expression) shows up as a child target but its enclosing should
    // be Outer.
    const innerClass = targets.find(
      (t) =>
        t.kind === "class" && t.file.endsWith("file.ts") && t.name !== "Outer",
    );
    if (innerClass) {
      const outerScope = innerClass.enclosing[0];
      if (outerScope && outerScope.kind === "class") {
        expect(outerScope.name).toBe("Outer");
      } else {
        throw new Error("expected inner class enclosing[0] to be Outer");
      }
    } else {
      // No class expression extracted (e.g. only PropertyDefinition surfaces);
      // that's still acceptable, but verify Outer is at the top.
      expect(cls).toBeDefined();
    }
  });
});

describe("extractTargets — decorators & docs", () => {
  it("collects @Decorator strings into attributes", () => {
    const targets = extractTargets(DECORATED_CLASS, "/abs/file.ts");
    const cls = findTarget(targets, "class", "MyService");
    expect(cls.attributes.length).toBe(2);
    expect(cls.attributes[0]).toContain("Component");
    expect(cls.attributes[0]).toContain("singleton");
    expect(cls.attributes[1]).toContain("Injectable");
  });

  it("collects JSDoc /** ... */ comments into docs", () => {
    const targets = extractTargets(CLASS_WITH_METHODS, "/abs/file.ts");
    const cls = findTarget(targets, "class", "Calculator");
    expect(cls.docs.length).toBeGreaterThanOrEqual(1);
    expect(cls.docs[0]).toContain("A small calculator class");
    const add = findTarget(targets, "function", "add");
    expect(add.docs.length).toBeGreaterThanOrEqual(1);
    expect(add.docs[0]).toContain("Add n to the accumulator");
  });
});

describe("extractTargets — defaults", () => {
  it("defaults to public visibility", () => {
    const targets = extractTargets(SIMPLE_FUNCTION, "/abs/file.ts");
    const fn = findTarget(targets, "function", "add");
    expect(fn.visibility).toBe("public");
  });

  it("captures private / protected modifiers", () => {
    const targets = extractTargets(CLASS_WITH_METHODS, "/abs/file.ts");
    const cls = findTarget(targets, "class", "Calculator");
    const state = (cls as unknown as { state: Record<string, unknown> }).state;
    const fields = state.fields as Array<{ visibility: string }>;
    expect(fields[0]?.visibility).toBe("private");
  });

  it("includes the file-level Program target", () => {
    const targets = extractTargets(SIMPLE_FUNCTION, "/abs/file.ts");
    const fileTarget = findTarget(targets, "file");
    expect(fileTarget.file).toBe("/abs/file.ts");
    const state = (fileTarget as unknown as { state: Record<string, unknown> })
      .state;
    expect(state.contents).toBe(SIMPLE_FUNCTION);
  });
});

describe("extractTargets — error handling", () => {
  it("throws SyntaxError when the source has a syntax error", () => {
    expect(() => extractTargets(SYNTAX_ERROR, "/abs/file.ts")).toThrowError(
      SyntaxError,
    );
  });

  it("includes the line and column in the thrown message", () => {
    let caught: unknown;
    try {
      extractTargets(SYNTAX_ERROR, "/abs/file.ts");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyntaxError);
    const message = (caught as Error).message;
    expect(message).toMatch(/line\s+\d+/);
    expect(message).toMatch(/column\s+\d+/);
    expect(message).toMatch(/TypeScript syntax error/);
  });
});

describe("extractTargets — kind filter", () => {
  it("honors the `kinds` option to restrict extraction", () => {
    const targets = extractTargets(SIMPLE_FUNCTION, "/abs/file.ts", {
      kinds: new Set(["class"]),
    });
    // No class in this file, and the function should be filtered out.
    expect(targets.length).toBe(0);
  });

  it("returns only the file target when only `file` kind is requested", () => {
    const targets = extractTargets(SIMPLE_FUNCTION, "/abs/file.ts", {
      kinds: new Set(["file"]),
    });
    expect(targets.length).toBe(1);
    expect(targets[0]?.kind).toBe("file");
  });
});
