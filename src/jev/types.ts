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

export interface ChoiceQuestion {
  readonly type: ChoiceType;
  readonly instructions: string;
  /** Choice id → human label. 2..255 entries; non-empty keys. */
  readonly criteria: Readonly<Record<string, string>>;
}

export type Question = ChoiceQuestion;

export function validateQuestion(question: Question): void {
  if (question.type !== "choice") {
    throw new Error(`Unknown question type: ${String(question.type)}`);
  }
  if (question.instructions.trim().length === 0) {
    throw new Error("question instructions must not be empty");
  }
  const count = Object.keys(question.criteria).length;
  if (count < 2 || count > 255) {
    throw new Error(`a choice question requires 2 to 255 choices, got ${count}`);
  }
  for (const key of Object.keys(question.criteria)) {
    if (key.trim().length === 0) {
      throw new Error("choice names must not be empty");
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
