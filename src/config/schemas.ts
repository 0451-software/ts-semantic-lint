/**
 * Zod schemas for `ts-semantic-lint` config files.
 *
 * Mirrors the behavioral contract of ErisLint's `src/config.rs` but expressed
 * for TypeScript source and validated by Zod. Every field is intentionally
 * strict: unknown keys, malformed values, and missing required fields are
 * rejected with a human-readable ZodIssue path.
 *
 * The `z.strictObject(...)` calls replace Zod v3's `.strict()` (deprecated in
 * Zod 4 in favor of the top-level `strictObject` factory).
 */
import { z } from "zod";

// ─── Primitives ──────────────────────────────────────────────────────────────

/**
 * Closed-interval probability / confidence in [0, 1]. Finite numbers only;
 * NaN / Infinity rejected. Zod 4's `z.number()` already rejects ±Infinity, so
 * the `Number.isFinite` refine is now redundant — kept as a defense-in-depth
 * guard so this schema still rejects NaN.
 */
export const ProbabilitySchema = z
  .number()
  .refine((n) => Number.isFinite(n), {
    message: "must be a finite number",
  })
  .refine((n) => n >= 0 && n <= 1, {
    message: "must be between 0 and 1",
  });

/**
 * Rule IDs must contain only letters, digits, `.`, `_`, `-`. Mirrors the
 * Rust validation: `rule.id.chars().all(|c| c.is_ascii_alphanumeric() ||
 * matches!(c, '_' | '-' | '.'))`.
 */
export const RuleIdSchema = z
  .string()
  .min(1, { message: "rule id must not be empty" })
  .regex(/^[a-zA-Z0-9._-]+$/, {
    message: "rule ids must contain only letters, digits, '.', '_' or '-'",
  });

/**
 * Canonical TypeScript AST node kinds that map to a `LintedTarget.kind`.
 * Open-ended in principle (anything in typescript-estree) but the loader
 * narrows to this list so misconfigurations surface at config-load time.
 */
export const TargetKindSchema = z.enum([
  "function", // any function-like declaration (resolved per-node)
  "class",
  "interface",
  "type",
  "enum",
  "module",
  "file",
  // PascalCase aliases mirroring typescript-estree node kinds.
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "MethodDefinition",
  "ClassDeclaration",
  "ClassExpression",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);

// ─── Selector ────────────────────────────────────────────────────────────────

export const SelectorSchema = z.strictObject({
  kind: TargetKindSchema,
  has_body: z.boolean().optional(),
  has_name: z.boolean().optional(),
  name: z.string().min(1).optional(),
  name_pattern: z.string().min(1).optional(),
  visibility: z.enum(["public", "private", "protected"]).optional(),
  files: z.array(z.string().min(1)).default([]),
  exclude: z.array(z.string().min(1)).default([]),
});

// ─── Question ────────────────────────────────────────────────────────────────

/**
 * Structured `instructions` — the Jev best-practice shape for prompts that
 * point at a specific field or add a focus clause. Either form (plain
 * string or object) is accepted; the runner flattens to a single string
 * at the HTTP-boundary so the wire payload stays string-only.
 *
 * `question` is the actual instructions text. `focus` (when present)
 * narrows what the model should weigh. `inspect` (when present) names
 * the state fields the model should read first.
 *
 * See `references/primitives.md` ("Structured `instructions`") in the
 * typesafe-ai skill for rationale.
 */
export const StructuredInstructionsSchema = z.strictObject({
  question: z
    .string()
    .min(1)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: "question must not be empty",
    }),
  focus: z.string().optional(),
  inspect: z.string().optional(),
});

/**
 * Structured criterion — the Jev best-practice shape for near-options
 * that need `what` / `not_for` / `examples` to pin down coverage. The
 * plain-string form is still accepted for backwards compatibility.
 *
 * See `references/primitives.md` ("Structured `criteria`") in the
 * typesafe-ai skill for rationale.
 */
export const ChoiceCriterionSchema = z.union([
  z.string().min(1),
  z.strictObject({
    what: z.string().min(1),
    not_for: z.string().optional(),
    examples: z.array(z.string().min(1)).optional(),
  }),
]);

/**
 * A single choice question sent to Jev. 2–255 non-empty criteria.
 * Instructions must be non-empty after trimming (either as a plain
 * string, or via the `question` field of the structured form).
 */
export const ChoiceQuestionSchema = z.strictObject({
  type: z.literal("choice"),
  instructions: z.union([
    z
      .string()
      .transform((s) => s.trim())
      .refine((s) => s.length > 0, {
        message: "question instructions must not be empty",
      }),
    StructuredInstructionsSchema,
  ]),
  criteria: z.record(z.string().min(1), ChoiceCriterionSchema).refine(
    (c) => {
      const n = Object.keys(c).length;
      return n >= 2 && n <= 255;
    },
    { message: "a choice question requires 2 to 255 choices" },
  ),
});

export const QuestionSchema = ChoiceQuestionSchema; // v1: only Choice.

// ─── Diagnostic policy + condition ───────────────────────────────────────────

export const ChoiceProbabilitySchema = z
  .strictObject({
    choice: z.string().min(1),
    min: ProbabilitySchema.optional(),
    max: ProbabilitySchema.optional(),
  })
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, {
    message: "probability min exceeds max",
    path: ["min"],
  })
  .refine((v) => v.min !== undefined || v.max !== undefined, {
    message: "probability needs min or max",
  });

// ─── Condition ───────────────────────────────────────────────────────────────

/**
 * Recursive `Condition` shape. Mirrors the Rust `Condition` struct
 * (choice, min_confidence, max_confidence, probability, all, any).
 */
export interface ConditionInput {
  choice?: string;
  min_confidence?: number;
  max_confidence?: number;
  probability?: {
    choice: string;
    min?: number;
    max?: number;
  };
  all?: ConditionInput[];
  any?: ConditionInput[];
}

// Internal: the lazy `Condition` schema (recursive). We type it via
// `z.ZodType` (a Zod-provided alias) because Zod can't infer the
// optional-field match when wrapped in `z.ZodType<ConditionInput>`.
// The cast at the bottom converts it back to the typed surface.
//
// Zod 4's `z.ZodType` generic is now `<Output = unknown, Input = unknown>`
// (the `Def` parameter was removed); casting to the typed surface still
// works the same way as in Zod 3.
const ConditionSchemaImpl: z.ZodType = z.lazy(() =>
  z
    .strictObject({
      choice: z.string().min(1).optional(),
      min_confidence: ProbabilitySchema.optional(),
      max_confidence: ProbabilitySchema.optional(),
      probability: ChoiceProbabilitySchema.optional(),
      all: z.array(ConditionSchemaImpl).min(1).optional(),
      any: z.array(ConditionSchemaImpl).min(1).optional(),
    })
    .refine(
      (v) =>
        v.min_confidence === undefined ||
        v.max_confidence === undefined ||
        v.min_confidence <= v.max_confidence,
      {
        message: "min_confidence exceeds max_confidence",
        path: ["min_confidence"],
      },
    ),
);

/** Public `Condition` schema (recursive). */
export const ConditionSchema: z.ZodType<ConditionInput> =
  ConditionSchemaImpl as z.ZodType<ConditionInput>;

export const DiagnosticLevelSchema = z.enum(["warn", "error"]);

export const DiagnosticPolicySchema = z.strictObject({
  when: ConditionSchema,
  level: DiagnosticLevelSchema,
  message: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: "diagnostic message must not be empty",
    }),
});

// ─── Rule ────────────────────────────────────────────────────────────────────

/**
 * Rule context — how much surrounding code to ship to Jev.
 * Mirrors Rust's `InputContext { Target, Enclosing, File }`.
 */
export const InputContextSchema = z
  .enum(["target", "enclosing", "file"])
  .default("enclosing");

/**
 * The single-rule schema. The JSON-Schema generator (`json-schema.ts`)
 * names the emitted schema `Rule`; that naming is handled by the wrapper
 * layer, so no per-schema registry registration is needed here.
 */
export const RuleSchema = z.strictObject({
  $schema: z.string().optional(),
  id: RuleIdSchema,
  where: SelectorSchema,
  context: InputContextSchema.optional(),
  question: QuestionSchema,
  diagnostics: z.array(DiagnosticPolicySchema).min(1, {
    message: "rule needs at least one diagnostic policy",
  }),
});

// ─── Override ────────────────────────────────────────────────────────────────

export const RuleSettingSchema = z.enum(["off", "warn", "error"]);

export const OverrideSchema = z.strictObject({
  files: z.array(z.string().min(1)).min(1, {
    message: "overrides require at least one file pattern",
  }),
  exclude: z.array(z.string().min(1)).default([]),
  rules: z.record(z.string().min(1), RuleSettingSchema),
});

// ─── Top-level config file ───────────────────────────────────────────────────

/**
 * The on-disk config file shape. Equivalent to ErisLint's `ConfigFile`.
 *
 * `version` defaults to 1; only 1 is accepted. All other fields are
 * optional except `rules` (must contain ≥1 rule).
 *
 * The JSON-Schema generator (`json-schema.ts`) names the emitted schema
 * `ConfigFile`; that naming is handled by the wrapper layer, so no
 * per-schema registry registration is needed here.
 */
export const ConfigFileSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1).default(1),
  extends: z.array(z.string().min(1)).default([]),
  model: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "model must not be empty" })
    .optional(),
  include: z
    .array(z.string().min(1))
    .min(1, { message: "include must contain at least one file pattern" })
    .optional(),
  exclude: z.array(z.string().min(1)).default([]),
  rules: z.array(RuleSchema).default([]),
  rule_files: z.array(z.string().min(1)).default([]),
  overrides: z.array(OverrideSchema).default([]),
});

export type ConfigFileInput = z.infer<typeof ConfigFileSchema>;
export type RuleInput = z.infer<typeof RuleSchema>;
export type SelectorInput = z.infer<typeof SelectorSchema>;
export type OverrideInput = z.infer<typeof OverrideSchema>;
export type DiagnosticPolicyInput = z.infer<typeof DiagnosticPolicySchema>;
export type QuestionInput = z.infer<typeof QuestionSchema>;
export type RuleSettingInput = z.infer<typeof RuleSettingSchema>;
