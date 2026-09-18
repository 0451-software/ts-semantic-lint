/**
 * Sample TypeScript snippets used by `analyzer.test.ts`.
 *
 * Each export is a self-contained TS source string. Imports would be inlined
 * as `declare module` snippets so the fixtures parse without bringing in
 * project-internal dependencies.
 *
 * Note: we use plain string concatenation rather than template literals so
 * that backticks inside the fixture source (e.g. JSDoc examples) don't
 * confuse the host parser.
 */

const SIMPLE_FUNCTION_LINES: string[] = [
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "",
];

export const SIMPLE_FUNCTION: string = SIMPLE_FUNCTION_LINES.join("\n");

export const NAMED_ARROW: string = [
  "export const greet = (name: string): string => {",
  "  return `Hello, ${name}`;",
  "};",
  "",
].join("\n");

export const ANONYMOUS_ARROW: string = [
  "const handler = (): number => 42;",
  "",
].join("\n");

const CLASS_WITH_METHODS_LINES: string[] = [
  "/**",
  " * A small calculator class.",
  " */",
  "export class Calculator {",
  "  /** Accumulated value. */",
  "  private value: number = 0;",
  "",
  "  /**",
  "   * Add n to the accumulator.",
  "   */",
  "  public add(n: number): void {",
  "    this.value = this.value + n;",
  "  }",
  "",
  "  /** Return the current value. */",
  "  protected current(): number {",
  "    return this.value;",
  "  }",
  "}",
  "",
];

export const CLASS_WITH_METHODS: string = CLASS_WITH_METHODS_LINES.join("\n");

const INTERFACE_DECL_LINES: string[] = [
  "/**",
  " * Anything that can be measured.",
  " */",
  "export interface Measurable {",
  "  /** Length in millimeters. */",
  "  readonly length: number;",
  "  /** Optional human label. */",
  "  label?: string;",
  "}",
  "",
];

export const INTERFACE_DECL: string = INTERFACE_DECL_LINES.join("\n");

const TYPE_ALIAS_LINES: string[] = [
  "/** A user identifier — branded string. */",
  "export type UserId = string & { readonly __brand: 'UserId' };",
  "",
];

export const TYPE_ALIAS: string = TYPE_ALIAS_LINES.join("\n");

const ENUM_DECL_LINES: string[] = [
  "/** All supported log levels. */",
  "export enum LogLevel {",
  "  Debug,",
  "  Info,",
  "  Warn,",
  "  Error,",
  "}",
  "",
];

export const ENUM_DECL: string = ENUM_DECL_LINES.join("\n");

const MODULE_DECL_LINES: string[] = [
  "/**",
  " * Helpers for working with URLs.",
  " */",
  "export namespace urls {",
  "  /** Build a URL from a base path and query. */",
  "  export function build(base: string, query: Record<string, string>): string {",
  "    const parts = Object.entries(query)",
  "      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)",
  "      .join('&');",
  "    return `${base}?${parts}`;",
  "  }",
  "}",
  "",
];

export const MODULE_DECL: string = MODULE_DECL_LINES.join("\n");

const DECORATED_CLASS_LINES: string[] = [
  "/**",
  " * Service registered with the DI container.",
  " */",
  "@Component({ scope: 'singleton' })",
  "@Injectable()",
  "export class MyService {",
  "  constructor(private readonly dep: Dep) {}",
  "",
  "  /** Run the service. */",
  "  run(): number {",
  "    return this.dep.value;",
  "  }",
  "}",
  "",
];

export const DECORATED_CLASS: string = DECORATED_CLASS_LINES.join("\n");

export const DECLARE_FUNCTION: string = [
  "/** Ambient module declaration. */",
  "declare function ambient(x: number): number;",
  "",
].join("\n");

const NESTED_FUNCTIONS_LINES: string[] = [
  "/** Outer scope. */",
  "export function outer(): void {",
  "  /** Inner scope. */",
  "  function inner(): number {",
  "    return 42;",
  "  }",
  "  const arrow = (x: number): number => x + 1;",
  "  inner();",
  "  arrow(1);",
  "}",
  "",
];

export const NESTED_FUNCTIONS: string = NESTED_FUNCTIONS_LINES.join("\n");

const NESTED_CLASS_LINES: string[] = [
  "/**",
  " * Outer container.",
  " */",
  "export class Outer {",
  "  /**",
  "   * Inner value holder.",
  "   */",
  "  static Inner = class {",
  "    /** A method on Inner. */",
  "    ping(): string {",
  "      return 'pong';",
  "    }",
  "  };",
  "}",
  "",
];

export const NESTED_CLASS: string = NESTED_CLASS_LINES.join("\n");

export const SYNTAX_ERROR: string = [
  "function broken(a: number {",
  "  return a;",
  "}",
  "",
].join("\n");

export const SYNTAX_OK_BUT_WARNINGS: string = [
  "export const x: number = 'wrong type';",
  "",
].join("\n");
