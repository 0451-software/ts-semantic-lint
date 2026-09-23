/**
 * Types for the TypeSafe Jev HTTP client.
 *
 * These types are the Jev-module equivalent of the Rust `src/jev.rs`
 * request / response / question / answer shapes. They are intentionally
 * module-local because the parallel-safe coding rules forbid importing
 * sibling modules during this PR cycle.
 *
 * The shared `JevChoiceAnswer` shape (what callers receive per target)
 * still lives in `src/types.ts`.
 */

import type { JevAnswer } from "../types.js";

// ─── Probability ────────────────────────────────────────────────────────────

/**
 * A probability in the closed interval `[0, 1]`.
 *
 * Brand is `readonly __brand: 'Probability'` so plain numbers cannot be
 * passed where a `Probability` is expected. Construct via `makeProbability`
 * (which validates the range and rejects `NaN` / `±Infinity`).
 */
export type Probability = number & { readonly __brand: "Probability" };

/** Internal sentinel thrown by `makeProbability` on invalid input. */
export class ProbabilityRangeError extends Error {
  override readonly name = "ProbabilityRangeError";
  constructor(value: number) {
    super(`Probability must be in [0, 1], received ${value}`);
  }
}

/**
 * Validate and brand a probability. Throws `ProbabilityRangeError` when
 * the value is `NaN`, infinite, or outside `[0, 1]`.
 */
export function makeProbability(value: number): Probability {
  if (!Number.isFinite(value)) {
    throw new ProbabilityRangeError(value);
  }
  if (value < 0 || value > 1) {
    throw new ProbabilityRangeError(value);
  }
  return value as Probability;
}

// ─── Questions ─────────────────────────────────────────────────────────────

export type ChoiceType = "choice";

/**
 * Structured criterion — what the config holds. Either a plain string
 * (the v0 form, still supported for backwards compatibility) or an
 * object with `what` / `not_for` / `examples` per the Jev best-practice
 * for disambiguating near-options. The HTTP body sent to Jev is always
 * flat strings — see `normalizeCriterion` for the boundary conversion.
 *
 * The optional fields are typed `string | undefined` (not `?: string`) so
 * the shape is assignable from Zod-inferred types under
 * `exactOptionalPropertyTypes: true`.
 */
export type ChoiceCriterionInput =
  | string
  | {
      readonly what: string;
      readonly not_for?: string | undefined;
      readonly examples?: readonly string[] | undefined;
    };

/**
 * Structured instructions — what the config holds. Either a plain
 * string (v0 form, backwards-compatible) or an object with `question` /
 * `focus` / `inspect`. The HTTP body sent to Jev is always a single
 * string — see `normalizeInstructions` for the boundary conversion.
 *
 * Optional fields are typed `string | undefined` (not `?: string`) so the
 * shape is assignable from Zod-inferred types under
 * `exactOptionalPropertyTypes: true`.
 */
export type InstructionsInput =
  | string
  | {
      readonly question: string;
      readonly focus?: string | undefined;
      readonly inspect?: string | undefined;
    };

/**
 * The parsed config shape of a Choice question, holding the structured
 * form. The runner flattens these into the wire shape (`Question` /
 * `ChoiceQuestion`) when constructing the Jev HTTP body.
 */
export interface ChoiceQuestionInput {
  readonly type: ChoiceType;
  readonly instructions: InstructionsInput;
  /** Choice id → criterion (string or structured object). 2..255 entries. */
  readonly criteria: Readonly<Record<string, ChoiceCriterionInput>>;
}

/**
 * Flatten an `InstructionsInput` to the single string the Jev HTTP API
 * accepts. When the input is a structured object, `focus` and `inspect`
 * are appended so the model still sees the rubric context.
 */
export function normalizeInstructions(input: InstructionsInput): string {
  if (typeof input === "string") return input;
  const parts: string[] = [input.question];
  if (input.focus !== undefined && input.focus.trim().length > 0) {
    parts.push(`Focus: ${input.focus}`);
  }
  if (input.inspect !== undefined && input.inspect.trim().length > 0) {
    parts.push(`Inspect: ${input.inspect}`);
  }
  return parts.join(" ");
}

/**
 * Flatten a `ChoiceCriterionInput` to the single string the Jev HTTP
 * API accepts. When the input is a structured object, `not_for` and
 * `examples` are appended so the model still sees the rubric context.
 */
export function normalizeCriterion(input: ChoiceCriterionInput): string {
  if (typeof input === "string") return input;
  const parts: string[] = [input.what];
  if (input.not_for !== undefined && input.not_for.trim().length > 0) {
    parts.push(`Not for: ${input.not_for}`);
  }
  if (input.examples !== undefined && input.examples.length > 0) {
    parts.push(`Examples: ${input.examples.join("; ")}`);
  }
  return parts.join(" ");
}

/**
 * The wire shape — what the Jev HTTP API actually receives. Both
 * `instructions` and every criterion value are flat strings. Build this
 * shape from a parsed `ChoiceQuestionInput` via `toWireQuestion` so the
 * flattening logic lives in one place.
 */
export interface ChoiceQuestion {
  readonly type: ChoiceType;
  readonly instructions: string;
  /** Choice id → human label. 2..255 entries; non-empty keys. */
  readonly criteria: Readonly<Record<string, string>>;
}

export type Question = ChoiceQuestion;

/**
 * Convert a parsed config `ChoiceQuestionInput` (structured form) to
 * the wire `Question` (flat strings) the Jev HTTP client actually
 * receives. This is the boundary: the config holds the structured form
 * for clarity, the HTTP body is the derived flat string.
 */
export function toWireQuestion(input: ChoiceQuestionInput): Question {
  const criteria: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.criteria)) {
    criteria[key] = normalizeCriterion(value);
  }
  return {
    type: "choice",
    instructions: normalizeInstructions(input.instructions),
    criteria,
  };
}

export function validateQuestion(question: Question): void {
  if (question.type !== "choice") {
    throw new Error(`Unknown question type: ${String(question.type)}`);
  }
  if (question.instructions.trim().length === 0) {
    throw new Error("question instructions must not be empty");
  }
  const count = Object.keys(question.criteria).length;
  if (count < 2 || count > 255) {
    throw new Error(
      `a choice question requires 2 to 255 choices, got ${count}`,
    );
  }
  for (const key of Object.keys(question.criteria)) {
    if (key.trim().length === 0) {
      throw new Error("choice names must not be empty");
    }
  }
  for (const [key, value] of Object.entries(question.criteria)) {
    if (value.trim().length === 0) {
      throw new Error(`choice "${key}" description must not be empty`);
    }
  }
}

// ─── Request ───────────────────────────────────────────────────────────────

/** Mirrors `Request` in `src/jev.rs`. */
export interface Request {
  readonly model: string;
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
}

// ─── Answer ────────────────────────────────────────────────────────────────

export interface ChoiceAnswer {
  readonly type: ChoiceType;
  readonly choice: string;
  readonly confidence: Probability;
  readonly probabilities: Readonly<Record<string, Probability>>;
}

// ─── Response ──────────────────────────────────────────────────────────────

/** Mirrors `Response` in `src/jev.rs`. */
export interface Response {
  readonly model: string;
  readonly answers: Readonly<Record<string, ChoiceAnswer>>;
}

/** Convert a Jev wire `Response` into the shared per-target `JevAnswer`. */
export function toSharedAnswer(answer: ChoiceAnswer): JevAnswer {
  // The shared `JevChoiceAnswer` uses plain numbers, not the branded
  // `Probability` — strip the brand by re-materialising as `number`.
  const probabilities: Record<string, number> = {};
  for (const [key, value] of Object.entries(answer.probabilities)) {
    probabilities[key] = value;
  }
  return {
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities,
  };
}

export class ResponseValidationError extends Error {
  override readonly name = "ResponseValidationError";
}

export function validateResponse(response: Response, request: Request): void {
  if (response.model.trim().length === 0) {
    throw new ResponseValidationError("Jev returned an empty model identifier");
  }
  const responseKeys = Object.keys(response.answers).sort();
  const requestKeys = Object.keys(request.questions).sort();
  if (
    responseKeys.length !== requestKeys.length ||
    responseKeys.some((key, idx) => key !== requestKeys[idx])
  ) {
    throw new ResponseValidationError(
      "Jev returned missing or unexpected question ids",
    );
  }
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = response.answers[id];
    if (answer === undefined) {
      throw new ResponseValidationError(
        `Jev returned missing answer for question id "${id}"`,
      );
    }
    const criteria = question.criteria;
    if (!(answer.choice in criteria)) {
      throw new ResponseValidationError(
        `Jev returned unknown choice "${answer.choice}" for "${id}"`,
      );
    }
    const expectedKeys = Object.keys(criteria).sort();
    const actualKeys = Object.keys(answer.probabilities).sort();
    if (
      expectedKeys.length !== actualKeys.length ||
      expectedKeys.some((key, idx) => key !== actualKeys[idx])
    ) {
      throw new ResponseValidationError(
        `Jev returned missing or unexpected probabilities for "${id}"`,
      );
    }
  }
}
