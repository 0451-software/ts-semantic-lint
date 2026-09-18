/**
 * Shared types for ts-semantic-lint — single source of truth.
 *
 * Every module imports from here. Do not duplicate. Adding a new field
 * requires a type-contract PR (see docs/conventions.md).
 */
import type { TSESTree } from "@typescript-eslint/typescript-estree";

// ─── File representation ─────────────────────────────────────────────────────

/** Absolute, normalized path to a source file on disk. */
export type FilePath = string;

/** UTF-8 source text. Always a string, never a Buffer. */
export type SourceText = string;

/** Position in source: 1-indexed line, 1-indexed column (matches IDE/compiler-conventions). */
export interface SourceLocation {
  readonly line: number;
  readonly column: number;
  /** Zero-indexed byte offset into the file. */
  readonly offset: number;
}

/** Inclusive-exclusive [start, end) byte range. */
export interface SourceRange {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
}

// ─── Linting targets ─────────────────────────────────────────────────────────

/**
 * A linted AST node — the unit of work the runner hands to Jev.
 *
 * Mirrors `SyntaxTarget` from the Rust original. The `kind` field names
 * typescript-estree node kinds in camelCase (FunctionDeclaration, …).
 */
export interface LintedTarget {
  /** typescript-estree node kind, e.g. "FunctionDeclaration". */
  readonly kind: string;
  /** Node name when applicable (`undefined` for unnamed expressions). */
  readonly name?: string;
  /** Absolute path to the file containing this node. */
  readonly file: FilePath;
  /** Full source text of the file (file-level context only). */
  readonly fileText: SourceText;
  /** Byte range of just this node. */
  readonly range: SourceRange;
  /** Resolved start of the declaration token (e.g. `function` keyword). */
  readonly declarationStart?: SourceLocation;
  /** Source text of just this node's range — what we send to Jev. */
  readonly snippet: SourceText;
  /** Type parameters, e.g. `<T, U extends Foo>`. */
  readonly generics?: string;
  /** Where-clause text, e.g. `where T: Display`. (Not common in TS; reserved.) */
  readonly whereClause?: string;
  /** Raw attributes / decorators (TS `@decorator` syntax). */
  readonly attributes: readonly string[];
  /** Free-form JSDoc / doc comment lines. */
  readonly docs: readonly string[];
  /** Visibility: "public" | "private" | "protected". Defaults to "public". */
  readonly visibility: "public" | "private" | "protected";
  /** Enclosing scopes (outermost first). Empty at top-level. */
  readonly enclosing: readonly EnclosingScope[];
  /** All rules that selected this target, plus their context setting. */
  readonly appliedRules: readonly AppliedRule[];
}

export type EnclosingScope =
  | { readonly kind: "module"; readonly name?: string }
  | { readonly kind: "class"; readonly name?: string }
  | { readonly kind: "function"; readonly name?: string }
  | { readonly kind: "interface"; readonly name?: string }
  | { readonly kind: "type"; readonly name?: string };

/** A rule that matched a target, with its context setting. */
export interface AppliedRule {
  readonly ruleId: string;
  readonly context: RuleContext;
}

// ─── Rule system ─────────────────────────────────────────────────────────────

/** How much surrounding code the rule needs. */
export type RuleContext = "target" | "enclosing" | "file";

/** Source-language kind. v1: TypeScript only. */
export type Language = "typescript";

/** Where-clause selector. All fields AND together; undefined = wildcard. */
export interface Selector {
  readonly kind?: string;
  readonly hasBody?: boolean;
  readonly hasName?: boolean;
  readonly name?: string;
  readonly namePattern?: string;
  readonly visibility?: "public" | "private" | "protected";
  readonly files?: readonly string[];
  readonly exclude?: readonly string[];
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export type Severity = "warn" | "error" | "off";

export type DiagnosticLevel = "warn" | "error";

export interface Diagnostic {
  readonly ruleId: string;
  readonly level: DiagnosticLevel;
  readonly file: FilePath;
  readonly range: SourceRange;
  readonly snippet: SourceText;
  readonly message: string;
  readonly confidence?: number;
  readonly choice?: string;
  /** The full Jev answer — included in JSON / --all-answers modes. */
  readonly answer?: JevAnswer;
}

// ─── Jev answers ─────────────────────────────────────────────────────────────

/** One Choice question's answer from Jev. */
export interface JevChoiceAnswer {
  readonly choice: string;
  readonly confidence: number;
  /** All option probabilities, as returned by Jev. */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly rubric?: string;
  readonly model?: string;
}

/** All answers for one rule applied to one target. */
export type JevAnswer = JevChoiceAnswer;

/** Re-export so module consumers can import JevChoiceAnswer from `@/types.js`. */
export type { TSESTree };
