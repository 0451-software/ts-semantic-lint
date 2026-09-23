/**
 * Tests for the policy module: selector matching, condition matching,
 * message formatting, severity resolution, and the top-level evaluateRule.
 *
 * Tests are colocated with the module per `docs/conventions.md`. They are
 * excluded from the production tsconfig (the test-file glob) but vitest
 * compiles them via its own pipeline.
 */
import { describe, expect, it } from "vitest";
import type { JevAnswer, LintedTarget, SourceRange } from "../types.js";
import type { Condition, OverrideSetting, Rule } from "./types.js";
import { matches } from "./condition.js";
import { evaluateRule } from "./index.js";
import { formatMessage } from "./message.js";
import { matchesSelector } from "./selector.js";
import { resolveSeverity } from "./severity.js";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const START = { line: 1, column: 1, offset: 0 } as const;
const END = { line: 1, column: 10, offset: 9 } as const;
const RANGE: SourceRange = { start: START, end: END };

function makeTarget(overrides: Partial<LintedTarget> = {}): LintedTarget {
  return {
    kind: "FunctionDeclaration",
    name: "myFunc",
    file: "/src/example.ts",
    fileText: "",
    range: RANGE,
    snippet: "function myFunc() {}",
    attributes: [],
    docs: [],
    visibility: "public",
    enclosing: [],
    appliedRules: [],
    ...overrides,
  };
}

/** Overrides that may also set `hasBody` (an optional field not on LintedTarget). */
function targetWithBody(
  overrides: Partial<LintedTarget> & { hasBody?: boolean } = {},
): LintedTarget {
  const { hasBody: hb, ...rest } = overrides;
  const base = makeTarget(rest);
  return hb === undefined ? base : ({ ...base, hasBody: hb } as LintedTarget);
}

function makeAnswer(overrides: Partial<JevAnswer> = {}): JevAnswer {
  return {
    choice: "yes",
    confidence: 0.9,
    probabilities: { yes: 0.9, no: 0.1 },
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "test-rule",
    selector: { kind: "FunctionDeclaration" },
    diagnostics: [],
    ...overrides,
  };
}

// ─── matchesSelector ─────────────────────────────────────────────────────────

describe("matchesSelector", () => {
  it("matches when kind is equal", () => {
    expect(matchesSelector({ kind: "FunctionDeclaration" }, makeTarget())).toBe(
      true,
    );
  });

  it("does not match when kind differs", () => {
    expect(matchesSelector({ kind: "ClassDeclaration" }, makeTarget())).toBe(
      false,
    );
  });

  it("matches by namePattern regex", () => {
    expect(
      matchesSelector({ namePattern: "^my.*" }, makeTarget({ name: "myFunc" })),
    ).toBe(true);
    expect(
      matchesSelector(
        { namePattern: "^other" },
        makeTarget({ name: "myFunc" }),
      ),
    ).toBe(false);
  });

  it("does not match namePattern when target.name is undefined", () => {
    // Build a target without a name. exactOptionalPropertyTypes forbids
    // setting `name: undefined`, so we strip the property from a copy.
    const seed = makeTarget();
    const noName: LintedTarget = (() => {
      const { name: _, ...rest } = seed;
      void _;
      return rest;
    })();
    expect(matchesSelector({ namePattern: "^x" }, noName)).toBe(false);
  });

  it("fails closed on malformed regex", () => {
    expect(
      matchesSelector(
        { namePattern: "(unclosed" },
        makeTarget({ name: "anything" }),
      ),
    ).toBe(false);
  });

  it("matches files via tinyglobby glob", () => {
    expect(
      matchesSelector(
        { files: ["*.ts"] },
        makeTarget({ file: "/src/example.ts" }),
      ),
    ).toBe(true);
    expect(
      matchesSelector(
        { files: ["*.tsx"] },
        makeTarget({ file: "/src/example.ts" }),
      ),
    ).toBe(false);
  });

  it("matches nested files via double-star", () => {
    expect(
      matchesSelector(
        { files: ["src/**"] },
        makeTarget({ file: "/src/foo/bar.ts" }),
      ),
    ).toBe(true);
  });

  it("exclude: target.file matching any exclude pattern fails match", () => {
    expect(
      matchesSelector(
        { exclude: ["*.test.ts"] },
        makeTarget({ file: "/src/example.test.ts" }),
      ),
    ).toBe(false);
  });

  it("exclude: target.file matching no exclude pattern passes", () => {
    expect(
      matchesSelector(
        { exclude: ["*.test.ts"] },
        makeTarget({ file: "/src/example.ts" }),
      ),
    ).toBe(true);
  });

  it("AND semantics: all set fields must match", () => {
    expect(
      matchesSelector(
        { kind: "FunctionDeclaration", visibility: "public" },
        makeTarget({ kind: "FunctionDeclaration", visibility: "public" }),
      ),
    ).toBe(true);
    expect(
      matchesSelector(
        { kind: "FunctionDeclaration", visibility: "private" },
        makeTarget({ kind: "FunctionDeclaration", visibility: "public" }),
      ),
    ).toBe(false);
  });

  it("undefined selector fields are wildcards", () => {
    expect(matchesSelector({}, makeTarget())).toBe(true);
  });

  it("hasBody uses target.hasBody ?? false", () => {
    expect(
      matchesSelector({ hasBody: false }, targetWithBody({ hasBody: false })),
    ).toBe(true);
    expect(
      matchesSelector({ hasBody: true }, targetWithBody({ hasBody: false })),
    ).toBe(false);
  });
});

// ─── Condition.matches ───────────────────────────────────────────────────────

describe("Condition.matches", () => {
  it("matches on choice equality", () => {
    expect(matches({ choice: "yes" }, makeAnswer({ choice: "yes" }))).toBe(
      true,
    );
    expect(matches({ choice: "no" }, makeAnswer({ choice: "yes" }))).toBe(
      false,
    );
  });

  it("matches on min_confidence lower bound", () => {
    expect(
      matches({ min_confidence: 0.5 }, makeAnswer({ confidence: 0.7 })),
    ).toBe(true);
    expect(
      matches({ min_confidence: 0.5 }, makeAnswer({ confidence: 0.3 })),
    ).toBe(false);
  });

  it("matches on max_confidence upper bound", () => {
    expect(
      matches({ max_confidence: 0.8 }, makeAnswer({ confidence: 0.5 })),
    ).toBe(true);
    expect(
      matches({ max_confidence: 0.8 }, makeAnswer({ confidence: 0.95 })),
    ).toBe(false);
  });

  it("matches on confidence range (min and max)", () => {
    expect(
      matches(
        { min_confidence: 0.5, max_confidence: 0.9 },
        makeAnswer({ confidence: 0.7 }),
      ),
    ).toBe(true);
    expect(
      matches(
        { min_confidence: 0.5, max_confidence: 0.9 },
        makeAnswer({ confidence: 0.95 }),
      ),
    ).toBe(false);
  });

  it("contradictory confidence bounds (min > max) never match", () => {
    expect(
      matches(
        { min_confidence: 0.9, max_confidence: 0.1 },
        makeAnswer({ confidence: 0.5 }),
      ),
    ).toBe(false);
  });

  it("matches on probability single bound", () => {
    expect(
      matches(
        { probability: { choice: "yes", min: 0.7 } },
        makeAnswer({ probabilities: { yes: 0.9, no: 0.1 } }),
      ),
    ).toBe(true);
    expect(
      matches(
        { probability: { choice: "yes", min: 0.95 } },
        makeAnswer({ probabilities: { yes: 0.9, no: 0.1 } }),
      ),
    ).toBe(false);
  });

  it("matches on probability range", () => {
    expect(
      matches(
        {
          probability: { choice: "yes", min: 0.5, max: 0.95 },
        },
        makeAnswer({ probabilities: { yes: 0.8, no: 0.2 } }),
      ),
    ).toBe(true);
    expect(
      matches(
        {
          probability: { choice: "yes", min: 0.5, max: 0.7 },
        },
        makeAnswer({ probabilities: { yes: 0.9, no: 0.1 } }),
      ),
    ).toBe(false);
  });

  it("probability: missing choice returns no match", () => {
    expect(
      matches(
        { probability: { choice: "maybe", min: 0 } },
        makeAnswer({ probabilities: { yes: 0.9 } }),
      ),
    ).toBe(false);
  });

  it("all: every nested condition must match", () => {
    const cond: Condition = {
      all: [{ choice: "yes" }, { min_confidence: 0.5 }],
    };
    expect(matches(cond, makeAnswer({ choice: "yes", confidence: 0.9 }))).toBe(
      true,
    );
    expect(matches(cond, makeAnswer({ choice: "yes", confidence: 0.1 }))).toBe(
      false,
    );
  });

  it("any: at least one nested condition must match", () => {
    const cond: Condition = {
      any: [{ choice: "yes" }, { choice: "no" }],
    };
    expect(matches(cond, makeAnswer({ choice: "yes" }))).toBe(true);
    expect(matches(cond, makeAnswer({ choice: "no" }))).toBe(true);
    expect(matches(cond, makeAnswer({ choice: "maybe" }))).toBe(false);
  });

  it("nested all inside any", () => {
    const cond: Condition = {
      any: [
        { all: [{ choice: "yes" }, { min_confidence: 0.5 }] },
        { choice: "no" },
      ],
    };
    expect(matches(cond, makeAnswer({ choice: "yes", confidence: 0.9 }))).toBe(
      true,
    );
    expect(matches(cond, makeAnswer({ choice: "no", confidence: 0.1 }))).toBe(
      true,
    );
    expect(matches(cond, makeAnswer({ choice: "yes", confidence: 0.1 }))).toBe(
      false,
    );
  });
});

// ─── resolveSeverity ─────────────────────────────────────────────────────────

describe("resolveSeverity", () => {
  it("undefined override uses policy level", () => {
    expect(resolveSeverity("warn", undefined)).toBe("warn");
    expect(resolveSeverity("error", undefined)).toBe("error");
  });

  it("override 'error' forces error even if policy is warn", () => {
    expect(resolveSeverity("warn", "error")).toBe("error");
  });

  it("override 'warn' keeps policy level (does not downgrade error)", () => {
    expect(resolveSeverity("error", "warn")).toBe("error");
    expect(resolveSeverity("warn", "warn")).toBe("warn");
  });

  it("override 'off' returns off", () => {
    expect(resolveSeverity("warn", "off")).toBe("off");
    expect(resolveSeverity("error", "off")).toBe("off");
  });
});

// ─── formatMessage ───────────────────────────────────────────────────────────

describe("formatMessage", () => {
  it("replaces {name}, {kind}, {file}", () => {
    const out = formatMessage(
      "{name} is a {kind} in {file}",
      makeTarget({ name: "fn", kind: "FunctionDeclaration", file: "/x.ts" }),
    );
    expect(out).toBe("fn is a FunctionDeclaration in /x.ts");
  });

  it("leaves unknown placeholders verbatim", () => {
    const out = formatMessage(
      "name={name} unknown={bogus} kind={kind}",
      makeTarget({ name: "x", kind: "K" }),
    );
    expect(out).toBe("name=x unknown={bogus} kind=K");
  });

  it("empty {name} when target.name is undefined", () => {
    const seed = makeTarget();
    const noName: LintedTarget = (() => {
      const { name: _, ...rest } = seed;
      void _;
      return rest;
    })();
    expect(formatMessage("[{name}]", noName)).toBe("[]");
  });
});

// ─── evaluateRule ────────────────────────────────────────────────────────────

describe("evaluateRule", () => {
  it("returns null when no policy matches", () => {
    const rule = makeRule({
      diagnostics: [
        {
          when: { choice: "no" },
          level: "warn",
          message: "nope",
        },
      ],
    });
    expect(
      evaluateRule(rule, makeTarget(), makeAnswer(), undefined),
    ).toBeNull();
  });

  it("first matching policy wins (later policies skipped)", () => {
    const rule = makeRule({
      diagnostics: [
        {
          when: { choice: "yes" },
          level: "warn",
          message: "first",
        },
        {
          when: { choice: "yes" },
          level: "error",
          message: "second",
        },
      ],
    });
    const diag = evaluateRule(rule, makeTarget(), makeAnswer(), undefined);
    expect(diag).not.toBeNull();
    expect(diag?.message).toBe("first");
    expect(diag?.level).toBe("warn");
  });

  it("override 'error' upgrades policy from warn to error", () => {
    const rule = makeRule({
      diagnostics: [
        {
          when: { choice: "yes" },
          level: "warn",
          message: "msg",
        },
      ],
    });
    const override: OverrideSetting = "error";
    const diag = evaluateRule(rule, makeTarget(), makeAnswer(), override);
    expect(diag?.level).toBe("error");
  });

  it("override 'off' returns null even if condition matches", () => {
    const rule = makeRule({
      diagnostics: [
        {
          when: { choice: "yes" },
          level: "warn",
          message: "msg",
        },
      ],
    });
    const override: OverrideSetting = "off";
    expect(evaluateRule(rule, makeTarget(), makeAnswer(), override)).toBeNull();
  });

  it("emits a Diagnostic with ruleId, file, range, snippet, message, confidence, choice, answer", () => {
    const rule = makeRule({
      id: "my-rule",
      diagnostics: [
        {
          when: { choice: "yes" },
          level: "warn",
          message: "hello {name}",
        },
      ],
    });
    const answer = makeAnswer({ choice: "yes", confidence: 0.88 });
    const diag = evaluateRule(
      rule,
      makeTarget({ name: "world" }),
      answer,
      undefined,
    );
    expect(diag).not.toBeNull();
    expect(diag?.ruleId).toBe("my-rule");
    expect(diag?.file).toBe("/src/example.ts");
    expect(diag?.range).toEqual(RANGE);
    expect(diag?.snippet).toBe("function myFunc() {}");
    expect(diag?.message).toBe("hello world");
    expect(diag?.confidence).toBe(0.88);
    expect(diag?.choice).toBe("yes");
    expect(diag?.answer).toBe(answer);
  });

  it("falls back to default message when policy.message is missing", () => {
    const rule = makeRule({
      id: "fallback",
      diagnostics: [
        {
          when: { choice: "yes" },
          level: "warn",
        },
      ],
    });
    const diag = evaluateRule(rule, makeTarget(), makeAnswer(), undefined);
    expect(diag?.message).toBe("Rule fallback matched.");
  });

  it("skips policies whose condition does not match", () => {
    const rule = makeRule({
      diagnostics: [
        { when: { choice: "no" }, level: "warn", message: "no-msg" },
        { when: { choice: "yes" }, level: "warn", message: "yes-msg" },
      ],
    });
    const diag = evaluateRule(rule, makeTarget(), makeAnswer(), undefined);
    expect(diag?.message).toBe("yes-msg");
  });
});
