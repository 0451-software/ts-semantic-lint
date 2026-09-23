/**
 * Vitest tests for the `config` module.
 *
 * Uses fixtures in `./__fixtures__/` rather than inline JSON so the
 * fixtures double as documentation and can be exercised manually.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Config,
  ConfigError,
  CONFIG_NAME,
  DEFAULT_INCLUDE,
  DEFAULT_MODEL,
  discover,
  FileFilter,
  load,
  mergeFromPath,
} from "./index.js";
import { generateConfigSchema, generateRuleSchema } from "./json-schema.js";

import { ConfigFileSchema, RuleSchema, RuleIdSchema } from "./schemas.js";

import {
  normalizeInstructions,
  normalizeCriterion,
  toWireQuestion,
} from "../jev/types.js";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (rel: string): string => resolve(here, "__fixtures__", rel);

let scratchDir = "";

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "tsl-config-test-"));
});

afterEach(async () => {
  if (scratchDir) {
    await rm(scratchDir, { recursive: true, force: true });
    scratchDir = "";
  }
});

async function writeConfig(
  dir: string,
  name: string,
  body: object | string,
): Promise<string> {
  const path = join(dir, name);
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  await writeFile(path, text, "utf8");
  return path;
}

// ─── Basic load ──────────────────────────────────────────────────────────────

describe("load", () => {
  it("loads a minimal config", async () => {
    const config = await load(fx("minimal.json"));
    expect(config).toBeInstanceOf(Config);
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.rules.size).toBe(1);
    expect(config.rules.has("minimal-rule")).toBe(true);
  });

  it("applies default include when config omits it", async () => {
    const cfg = await load(fx("minimal.json"));
    expect([...cfg.filter.include]).toEqual([...DEFAULT_INCLUDE]);
  });

  it("default model is 'jev-latest'", async () => {
    const cfg = await load(fx("minimal.json"));
    expect(cfg.model).toBe("jev-latest");
  });

  it("loads inline rules from `rules`", async () => {
    const cfg = await load(fx("minimal.json"));
    const rule = cfg.rules.get("minimal-rule");
    expect(rule).toBeDefined();
    expect(rule?.definition.where.kind).toBe("function");
    expect(rule?.definition.diagnostics.length).toBe(1);
  });

  it("loads a single rule object from `rule_files`", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rule_files: ["./rule.json"],
    });
    await writeConfig(scratchDir, "rule.json", {
      id: "single-rule",
      where: { kind: "function" },
      question: {
        type: "choice",
        instructions: "is it good?",
        criteria: { yes: "y", no: "n" },
      },
      diagnostics: [
        {
          when: { choice: "no" },
          level: "warn",
          message: "fix it",
        },
      ],
    });
    const cfg = await load(cfgPath);
    expect(cfg.rules.has("single-rule")).toBe(true);
  });

  it("loads an array of rule objects from `rule_files`", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rule_files: ["./rules.json"],
    });
    await writeConfig(scratchDir, "rules.json", [
      {
        id: "r1",
        where: { kind: "function" },
        question: {
          type: "choice",
          instructions: "?",
          criteria: { a: "a", b: "b" },
        },
        diagnostics: [{ when: { choice: "a" }, level: "warn", message: "msg" }],
      },
      {
        id: "r2",
        where: { kind: "class" },
        question: {
          type: "choice",
          instructions: "?",
          criteria: { a: "a", b: "b" },
        },
        diagnostics: [{ when: { choice: "a" }, level: "warn", message: "msg" }],
      },
    ]);
    const cfg = await load(cfgPath);
    expect(cfg.rules.size).toBe(2);
    expect(cfg.rules.has("r1")).toBe(true);
    expect(cfg.rules.has("r2")).toBe(true);
  });
});

// ─── extends ─────────────────────────────────────────────────────────────────

describe("extends", () => {
  it("resolves a 3-deep chain — leaf wins over base for shared rules", async () => {
    const cfg = await load(fx("extends-chain/leaf.json"));
    // All three rule ids must be present.
    expect(cfg.rules.has("shared-rule")).toBe(true);
    expect(cfg.rules.has("mid-rule")).toBe(true);
    expect(cfg.rules.has("leaf-rule")).toBe(true);

    // shared-rule's diagnostics must come from leaf, not base.
    const shared = cfg.rules.get("shared-rule");
    expect(shared?.definition.diagnostics[0]?.level).toBe("error");
    expect(shared?.definition.diagnostics[0]?.message).toBe(
      "leaf overrides base message",
    );

    // Model must be the leaf's "leaf-model" — base's "base-model" was overwritten.
    expect(cfg.model).toBe("leaf-model");
  });

  it("rejects an extends cycle", async () => {
    await expect(load(fx("cycle/a.json"))).rejects.toThrow(/cycle/i);
  });

  it("rejects an extends chain deeper than 64", async () => {
    await expect(load(fx("deep/0.json"))).rejects.toThrow(/64/);
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe("validation", () => {
  it("rejects duplicate rule ids within a file", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "dup",
          where: { kind: "function" },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { a: "a", b: "b" },
          },
          diagnostics: [
            { when: { choice: "a" }, level: "warn", message: "msg" },
          ],
        },
        {
          id: "dup",
          where: { kind: "class" },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { a: "a", b: "b" },
          },
          diagnostics: [
            { when: { choice: "a" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    await expect(load(cfgPath)).rejects.toThrow(/duplicate rule id "dup"/);
  });

  it("rejects unknown choice name in `diagnostics.when.choice`", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "bad-choice",
          where: { kind: "function" },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { yes: "y", no: "n" },
          },
          diagnostics: [
            {
              when: { choice: "maybe" }, // not in criteria
              level: "warn",
              message: "msg",
            },
          ],
        },
      ],
    });
    await expect(load(cfgPath)).rejects.toThrow(/unknown choice "maybe"/);
  });

  it("rejects `has_body` on a non-function rule", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "class-with-body",
          where: { kind: "class", has_body: true },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { yes: "y", no: "n" },
          },
          diagnostics: [
            { when: { choice: "yes" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    await expect(load(cfgPath)).rejects.toThrow(
      /has_body is only valid for function/,
    );
  });

  it("rejects an override that references an unknown rule id", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "real-rule",
          where: { kind: "function" },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { yes: "y", no: "n" },
          },
          diagnostics: [
            { when: { choice: "yes" }, level: "warn", message: "msg" },
          ],
        },
      ],
      overrides: [
        {
          files: ["**/*.ts"],
          rules: { "missing-rule": "warn" },
        },
      ],
    });
    await expect(load(cfgPath)).rejects.toThrow(/unknown rule "missing-rule"/);
  });
});

// ─── Config.settingFor ───────────────────────────────────────────────────────

describe("Config.settingFor", () => {
  it("returns the last matching override's setting for a file+rule", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "r",
          where: { kind: "function" },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { yes: "y", no: "n" },
          },
          diagnostics: [
            { when: { choice: "yes" }, level: "warn", message: "msg" },
          ],
        },
      ],
      overrides: [
        // Earlier override sets `off` for everything.
        { files: ["**/*.ts"], rules: { r: "off" } },
        // Later override sets `error` for the tests directory — must win.
        { files: ["tests/**"], rules: { r: "error" } },
      ],
    });
    // Create the on-disk files so tinyglobby can match them.
    await mkdir(join(scratchDir, "tests"), { recursive: true });
    await mkdir(join(scratchDir, "src"), { recursive: true });
    await writeFile(join(scratchDir, "tests", "anything.test.ts"), "x");
    await writeFile(join(scratchDir, "src", "anything.ts"), "x");
    const cfg = await load(cfgPath);
    const testsFile = join(scratchDir, "tests", "anything.test.ts");
    const srcFile = join(scratchDir, "src", "anything.ts");

    expect(await cfg.settingFor(testsFile, "r")).toBe("error");
    expect(await cfg.settingFor(srcFile, "r")).toBe("off");
  });

  it("returns undefined when no override matches", async () => {
    const cfg = await load(fx("minimal.json"));
    const unrelated = join(scratchDir, "totally", "different.ts");
    expect(await cfg.settingFor(unrelated, "minimal-rule")).toBeUndefined();
  });
});

// ─── discover ────────────────────────────────────────────────────────────────

describe("discover", () => {
  it("walks up to .git and stops there", async () => {
    // Set up: <scratchDir>/.git, <scratchDir>/sub/deeper/file.ts
    //        <scratchDir>/ts-semantic-lint.json
    await mkdir(join(scratchDir, ".git"), { recursive: true });
    await mkdir(join(scratchDir, "sub", "deeper"), { recursive: true });
    await writeFile(
      join(scratchDir, "sub", "deeper", "file.ts"),
      "export {};\n",
    );
    await writeConfig(scratchDir, CONFIG_NAME, {
      version: 1,
      rules: [
        {
          id: "x",
          where: { kind: "function" },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { a: "a", b: "b" },
          },
          diagnostics: [{ when: { choice: "a" }, level: "warn", message: "m" }],
        },
      ],
    });

    const found = await discover(join(scratchDir, "sub", "deeper", "file.ts"));
    expect(found).toBe(join(scratchDir, CONFIG_NAME));
  });

  it("throws when no config is found before .git", async () => {
    // Repo with .git but no config file.
    await mkdir(join(scratchDir, ".git"), { recursive: true });
    await mkdir(join(scratchDir, "src"), { recursive: true });
    await writeFile(join(scratchDir, "src", "a.ts"), "export {};\n");
    await expect(discover(join(scratchDir, "src"))).rejects.toThrow(
      /no ts-semantic-lint\.json found/,
    );
  });
});

// ─── Structured criteria + instructions (feat-structured-criteria) ──────────

describe("structured criteria and instructions", () => {
  // Build a minimal config that exercises the new shape without relying
  // on disk fixtures — keeps the new test surface self-contained.
  function buildStructuredConfig(): object {
    return {
      version: 1,
      rules: [
        {
          id: "structured-rule",
          where: { kind: "function", files: [], exclude: [] },
          question: {
            type: "choice",
            instructions: {
              question: "Is this a clear question?",
              focus: "Judge clarity, not correctness.",
              inspect: "`name`, `body`",
            },
            criteria: {
              clear: {
                what: "The reader can act on it without follow-up questions.",
                not_for:
                  "Edge cases where correctness matters more than clarity.",
                examples: ["Adds two integers", "Returns the user's age"],
              },
              unclear: {
                what: "The reader would need to ask follow-up questions.",
              },
            },
          },
          diagnostics: [
            { when: { choice: "unclear" }, level: "warn", message: "msg" },
          ],
        },
      ],
    };
  }

  it("accepts structured instructions (object form)", async () => {
    const cfgPath = await writeConfig(
      scratchDir,
      "ts-semantic-lint.json",
      buildStructuredConfig(),
    );
    const cfg = await load(cfgPath);
    const rule = cfg.rules.get("structured-rule");
    expect(rule).toBeDefined();
    const instructions = rule?.definition.question.instructions;
    expect(typeof instructions).toBe("object");
    if (typeof instructions !== "string") {
      expect(instructions.question).toBe("Is this a clear question?");
      expect(instructions.focus).toBe("Judge clarity, not correctness.");
      expect(instructions.inspect).toBe("`name`, `body`");
    }
  });

  it("accepts flat-string instructions (backwards-compat)", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "flat-instr",
          where: { kind: "function", files: [], exclude: [] },
          question: {
            type: "choice",
            instructions: "plain string instructions",
            criteria: { a: "alpha", b: "beta" },
          },
          diagnostics: [
            { when: { choice: "a" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    const cfg = await load(cfgPath);
    const rule = cfg.rules.get("flat-instr");
    expect(rule?.definition.question.instructions).toBe(
      "plain string instructions",
    );
  });

  it("accepts criterion as a plain string (backwards-compat)", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "flat-crit",
          where: { kind: "function", files: [], exclude: [] },
          question: {
            type: "choice",
            instructions: "?",
            criteria: { yes: "A direct impl", no: "Indirection exists" },
          },
          diagnostics: [
            { when: { choice: "no" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    const cfg = await load(cfgPath);
    const criteria = cfg.rules.get("flat-crit")?.definition.question.criteria;
    expect(criteria?.["yes"]).toBe("A direct impl");
    expect(criteria?.["no"]).toBe("Indirection exists");
  });

  it("accepts criterion as { what, not_for, examples } (structured form)", async () => {
    const cfgPath = await writeConfig(
      scratchDir,
      "ts-semantic-lint.json",
      buildStructuredConfig(),
    );
    const cfg = await load(cfgPath);
    const criteria =
      cfg.rules.get("structured-rule")?.definition.question.criteria;
    expect(criteria).toBeDefined();
    const clear = criteria?.["clear"];
    expect(typeof clear).toBe("object");
    if (typeof clear !== "string" && clear !== undefined) {
      expect(clear.what).toBe(
        "The reader can act on it without follow-up questions.",
      );
      expect(clear.not_for).toBe(
        "Edge cases where correctness matters more than clarity.",
      );
      expect(clear.examples).toEqual([
        "Adds two integers",
        "Returns the user's age",
      ]);
    }
  });

  it("rejects a criterion object missing 'what'", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "bad-crit",
          where: { kind: "function", files: [], exclude: [] },
          question: {
            type: "choice",
            instructions: "?",
            criteria: {
              // missing required "what" field — must reject
              bad: { not_for: "no what here" } as unknown as string,
              ok: "fine",
            },
          },
          diagnostics: [
            { when: { choice: "ok" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    await expect(load(cfgPath)).rejects.toThrow();
  });

  it("rejects a criterion object with unknown keys (strict mode)", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "unknown-key",
          where: { kind: "function", files: [], exclude: [] },
          question: {
            type: "choice",
            instructions: "?",
            criteria: {
              bad: {
                what: "valid",
                unrelated_field: "should be rejected",
              } as unknown as string,
              ok: "fine",
            },
          },
          diagnostics: [
            { when: { choice: "ok" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    await expect(load(cfgPath)).rejects.toThrow();
  });

  it("rejects structured instructions missing 'question'", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "bad-instr",
          where: { kind: "function", files: [], exclude: [] },
          question: {
            type: "choice",
            instructions: { focus: "no question field" } as unknown as string,
            criteria: { a: "alpha", b: "beta" },
          },
          diagnostics: [
            { when: { choice: "a" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    await expect(load(cfgPath)).rejects.toThrow();
  });

  it("accepts a mix of string and structured criteria in the same question", async () => {
    const cfgPath = await writeConfig(scratchDir, "ts-semantic-lint.json", {
      version: 1,
      rules: [
        {
          id: "mixed",
          where: { kind: "function", files: [], exclude: [] },
          question: {
            type: "choice",
            instructions: "?",
            criteria: {
              flat: "A direct impl",
              structured: {
                what: "Indirection without payoff.",
                not_for: "Cases where indirection is required.",
              },
            },
          },
          diagnostics: [
            { when: { choice: "structured" }, level: "warn", message: "msg" },
          ],
        },
      ],
    });
    const cfg = await load(cfgPath);
    const criteria = cfg.rules.get("mixed")?.definition.question.criteria;
    expect(criteria?.["flat"]).toBe("A direct impl");
    const s = criteria?.["structured"];
    expect(typeof s).toBe("object");
  });
});

// ─── toWireQuestion (boundary normalizer) ───────────────────────────────────

describe("toWireQuestion — boundary normalization", () => {
  it("passes a string instructions through unchanged", () => {
    expect(normalizeInstructions("Plain question")).toBe("Plain question");
  });

  it("flattens object instructions to a single string", () => {
    const out = normalizeInstructions({
      question: "Q?",
      focus: "clarity",
      inspect: "`name`",
    });
    expect(out).toContain("Q?");
    expect(out).toContain("clarity");
    expect(out).toContain("`name`");
  });

  it("flattens object instructions without focus/inspect", () => {
    const out = normalizeInstructions({ question: "Just a question." });
    expect(out).toBe("Just a question.");
  });

  it("passes a string criterion through unchanged", () => {
    expect(normalizeCriterion("A direct impl")).toBe("A direct impl");
  });

  it("flattens object criterion (what only)", () => {
    expect(normalizeCriterion({ what: "Indirection without payoff." })).toBe(
      "Indirection without payoff.",
    );
  });

  it("flattens object criterion with what + not_for + examples", () => {
    const out = normalizeCriterion({
      what: "Indirection without payoff.",
      not_for: "Required indirection.",
      examples: ["Boolean flag with two near-identical branches"],
    });
    expect(out).toContain("Indirection without payoff.");
    expect(out).toContain("Required indirection.");
    expect(out).toContain("Boolean flag");
  });

  it("toWireQuestion produces a wire-shape Question with flat strings", () => {
    const wire = toWireQuestion({
      type: "choice",
      instructions: {
        question: "Q?",
        focus: "f",
        inspect: "i",
      },
      criteria: {
        yes: { what: "good", not_for: "edge cases" },
        no: "bad",
      },
    });
    expect(wire.type).toBe("choice");
    expect(typeof wire.instructions).toBe("string");
    expect(wire.instructions).toContain("Q?");
    expect(typeof wire.criteria["yes"]).toBe("string");
    expect(wire.criteria["yes"]).toContain("good");
    expect(wire.criteria["no"]).toBe("bad");
  });
});

// ─── JSON Schema ─────────────────────────────────────────────────────────────

describe("JSON Schema", () => {
  it("generateConfigSchema emits valid JSON Schema 2020-12", () => {
    const text = generateConfigSchema();
    const parsed: unknown = JSON.parse(text);
    expect(typeof parsed).toBe("object");
    // The output is `$ref`-wrapped; the actual schema lives under `definitions`.
    const root = parsed as {
      $schema?: string;
      $ref?: string;
      definitions?: Record<string, unknown>;
    };
    expect(root.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(root.definitions).toBeDefined();
    const defs = root.definitions ?? {};
    expect(Object.keys(defs).length).toBeGreaterThan(0);
    const cfg = defs["ConfigFile"] as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;
    expect(cfg).toBeDefined();
    expect(cfg?.properties).toBeDefined();
    expect(cfg?.properties?.["rules"]).toBeDefined();
  });

  it("generateRuleSchema emits valid JSON Schema 2020-12", () => {
    const text = generateRuleSchema();
    const parsed: unknown = JSON.parse(text);
    expect((parsed as { $schema?: string }).$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });
});

// ─── Schema validation (direct) ──────────────────────────────────────────────

describe("schemas (direct)", () => {
  it("RuleIdSchema rejects empty / invalid ids", () => {
    expect(RuleIdSchema.safeParse("").success).toBe(false);
    expect(RuleIdSchema.safeParse("with space").success).toBe(false);
    expect(RuleIdSchema.safeParse("ok-id_1.0").success).toBe(true);
  });

  it("ConfigFileSchema rejects unknown keys (deny_unknown_fields)", () => {
    const bad = { version: 1, rules: [], unknown_field: true };
    expect(ConfigFileSchema.safeParse(bad).success).toBe(false);
  });

  it("RuleSchema requires ≥1 diagnostic", () => {
    const bad = {
      id: "x",
      where: { kind: "function" },
      question: {
        type: "choice",
        instructions: "?",
        criteria: { a: "a", b: "b" },
      },
      diagnostics: [],
    };
    expect(RuleSchema.safeParse(bad).success).toBe(false);
  });
});

// ─── FileFilter ──────────────────────────────────────────────────────────────

describe("FileFilter", () => {
  it("rejects empty patterns", () => {
    expect(() => new FileFilter([""], [])).toThrow(ConfigError);
    expect(() => new FileFilter([], [""])).toThrow(ConfigError);
  });

  it("always excludes node_modules and .git directories", async () => {
    // Create the files so the glob can match them.
    await mkdir(join(scratchDir, "node_modules"), { recursive: true });
    await mkdir(join(scratchDir, ".git"), { recursive: true });
    await mkdir(join(scratchDir, "src"), { recursive: true });
    await writeFile(join(scratchDir, "node_modules", "foo.ts"), "x");
    await writeFile(join(scratchDir, ".git", "HEAD"), "x");
    await writeFile(join(scratchDir, "src", "ok.ts"), "x");
    const f = new FileFilter(["**/*.ts"], []);
    expect(
      await f.matches(join(scratchDir, "node_modules", "foo.ts"), scratchDir),
    ).toBe(false);
    expect(await f.matches(join(scratchDir, ".git", "HEAD"), scratchDir)).toBe(
      false,
    );
    expect(await f.matches(join(scratchDir, "src", "ok.ts"), scratchDir)).toBe(
      true,
    );
  });
});

// ─── mergeFromPath ───────────────────────────────────────────────────────────

describe("mergeFromPath", () => {
  it("merges overrides from multiple configs", async () => {
    const merged = await mergeFromPath(fx("extends-chain/leaf.json"));
    expect(merged.overrides.length).toBe(0); // none in this fixture
    expect(merged.rules.size).toBe(3);
  });
});
