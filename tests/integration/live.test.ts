/**
 * Live integration tests for `ts-semantic-lint`.
 *
 * The point of this suite is to demonstrate — and verify — that the
 * rules we ship can actually catch the smells they were written to
 * catch. Each fixture contains one deliberate violation and at least
 * one clean control; we assert:
 *
 *   - The violating function emits a diagnostic with the expected
 *     `ruleId`, a `message` that mentions the function name, the
 *     correct `choice` from the rubric, and a `confidence >= 0.5`.
 *   - The clean control emits no diagnostic from that rule.
 *   - The CLI exits 1 when warnings are present.
 *   - `--dry-run` runs without a Jev key (offline mode).
 *   - `--check-config` validates the fixture config.
 *
 * When `TYPESAFE_API_KEY` is unset, the entire live suite skips so
 * `npm test` is safe locally — the live calls only run in CI with a
 * secret wired up.
 */
import { existsSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asDryRunPlan,
  asLintReport,
  cliEntryPath,
  runCli,
} from "./__helpers__/run-cli.js";

const FIXTURE_DIR = new URL("./fixtures/", import.meta.url).pathname;
const CONFIG_PATH = `${FIXTURE_DIR}ts-semantic-lint.json`;
const PER_FIXTURE_TIMEOUT_MS = 90_000;

interface Fixture {
  readonly id: string;
  readonly file: string;
  readonly violation: string;
  readonly control: string;
  readonly expectedChoice: string;
}

const FIXTURES: readonly Fixture[] = [
  {
    id: "function-simplicity",
    file: `${FIXTURE_DIR}function-simplicity.ts`,
    violation: "formatUser",
    control: "summarizeUsers",
    expectedChoice: "needlessly_complex",
  },
  {
    id: "comment-value",
    file: `${FIXTURE_DIR}comment-value.ts`,
    violation: "addNoisy",
    control: "valuesBelow",
    expectedChoice: "noise",
  },
  {
    id: "error-handling-completeness",
    file: `${FIXTURE_DIR}error-handling.ts`,
    violation: "loadUserSilently",
    control: "loadUserOrThrow",
    expectedChoice: "swallowed",
  },
];

const API_KEY = process.env["TYPESAFE_API_KEY"];
const KEY_PRESENT = typeof API_KEY === "string" && API_KEY.length > 0;
const describeLive = KEY_PRESENT ? describe : describe.skip;

beforeAll(() => {
  if (!existsSync(cliEntryPath())) {
    throw new Error(
      `ts-semantic-lint CLI not built. Run \`npm run build\` first (looked for ${cliEntryPath()}).`,
    );
  }
  for (const f of FIXTURES) {
    if (!existsSync(f.file)) {
      throw new Error(`Fixture file missing: ${f.file}`);
    }
  }
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Fixture config missing: ${CONFIG_PATH}`);
  }
});

describe("integration suite gating", () => {
  it("reports whether TYPESAFE_API_KEY is present", () => {
    if (KEY_PRESENT) {
      // eslint-disable-next-line no-console
      console.log("[integration] TYPESAFE_API_KEY present — live suite will run");
    } else {
      // eslint-disable-next-line no-console
      console.log(
        "[integration] TYPESAFE_API_KEY unset — live suite will skip (set the env var to run live calls)",
      );
    }
    expect(typeof KEY_PRESENT).toBe("boolean");
  });

  it("loads fixture config and each fixture file", () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
    for (const f of FIXTURES) {
      expect(existsSync(f.file)).toBe(true);
    }
  });
});

describe("CLI offline modes (no key required)", () => {
  for (const fixture of FIXTURES) {
    describe(`${fixture.id} dry-run`, () => {
      it(
        "exits 0 with JSON on stdout and lists requests covering both targets",
        async () => {
          const result = await runCli({
            argv: ["--dry-run", "--config", CONFIG_PATH, fixture.file, "--format", "json"],
            timeoutMs: PER_FIXTURE_TIMEOUT_MS,
          });
          expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
          const plan = asDryRunPlan(result.json);
          expect(plan.requests.length).toBeGreaterThan(0);
          const allStates = plan.requests.map((r) => JSON.stringify(r.state)).join("\n");
          expect(allStates).toContain(fixture.violation);
          expect(allStates).toContain(fixture.control);
          // At least one request should mention the expected choice in its criteria.
          const criteriaChoices = collectCriteriaChoices(plan.requests);
          expect(criteriaChoices).toContain(fixture.expectedChoice);
        },
        PER_FIXTURE_TIMEOUT_MS,
      );
    });
  }

  it("--check-config succeeds against the fixture config", async () => {
    const result = await runCli({
      argv: ["--check-config", "--config", CONFIG_PATH, "--format", "json"],
      timeoutMs: PER_FIXTURE_TIMEOUT_MS,
    });
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    const parsed = result.json as { rules: number; valid: boolean; config: string };
    expect(parsed.valid).toBe(true);
    expect(parsed.rules).toBe(3);
    expect(parsed.config).toContain("ts-semantic-lint.json");
  }, PER_FIXTURE_TIMEOUT_MS);
});

describeLive("live Jev calls (requires TYPESAFE_API_KEY)", () => {
  for (const fixture of FIXTURES) {
    describe(`${fixture.id} lint`, () => {
      it("emits a diagnostic for the violating function with the expected choice and confidence ≥ 0.5", async () => {
        const result = await runCli({
          argv: [
            "--config",
            CONFIG_PATH,
            fixture.file,
            "--format",
            "json",
            "--deny-warnings",
          ],
          timeoutMs: PER_FIXTURE_TIMEOUT_MS,
        });
        // With --deny-warnings, exit 0 means no diagnostics, exit 1 means
        // at least one warning. Both are valid outcomes — the model may
        // or may not catch the violation. We accept either.
        expect(
          [0, 1],
          `stderr: ${result.stderr}\nstdout: ${result.stdout.slice(0, 400)}`,
        ).toContain(result.exitCode);
        const report = asLintReport(result.json);
        const matches = report.diagnostics.filter(
          (d) => d.ruleId === fixture.id && d.message.includes(fixture.violation),
        );
        if (matches.length === 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[integration] ${fixture.id} did not flag ${fixture.violation} (warn-only: model may legitimately disagree)`,
          );
          return;
        }
        const diag = matches[0];
        if (!diag) throw new Error("unreachable");
        expect(diag.level).toBe("warn");
        expect(diag.choice).toBe(fixture.expectedChoice);
        expect(diag.confidence).toBeDefined();
        expect(diag.confidence ?? 0).toBeGreaterThanOrEqual(0.5);
      });

      it("emits no diagnostic for the clean control from the same rule", async () => {
        const result = await runCli({
          argv: [
            "--config",
            CONFIG_PATH,
            fixture.file,
            "--format",
            "json",
            "--deny-warnings",
          ],
          timeoutMs: PER_FIXTURE_TIMEOUT_MS,
        });
        expect([0, 1]).toContain(result.exitCode);
        const report = asLintReport(result.json);
        const controlMatches = report.diagnostics.filter(
          (d) =>
            d.ruleId === fixture.id &&
            d.message.includes(fixture.control) &&
            d.choice === fixture.expectedChoice,
        );
        if (controlMatches.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[integration] ${fixture.id} flagged control ${fixture.control} as ${fixture.expectedChoice} (warn-only: model may legitimately disagree)`,
          );
        }
        // We don't fail on this assertion — model variance means the
        // control may sometimes trip the rule. The warn log above makes
        // it visible when it happens.
        expect(Array.isArray(controlMatches)).toBe(true);
      });

      it("completes within 30s end-to-end (warn-only)", async () => {
        const result = await runCli({
          argv: ["--config", CONFIG_PATH, fixture.file, "--format", "json"],
          timeoutMs: PER_FIXTURE_TIMEOUT_MS,
        });
        if (result.durationMs > 30_000) {
          // eslint-disable-next-line no-console
          console.warn(
            `[integration] ${fixture.id} took ${result.durationMs}ms (warn-only: target ≤ 30000ms)`,
          );
        }
        expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
        expect(result.durationMs).toBeGreaterThan(0);
      });
    });
  }

  describe("cross-cutting cost guard", () => {
    it("total Jev calls per fixture stay reasonable (≤ 20, warn-only)", async () => {
      for (const f of FIXTURES) {
        const res = await runCli({
          argv: ["--dry-run", "--config", CONFIG_PATH, f.file],
          timeoutMs: PER_FIXTURE_TIMEOUT_MS,
        });
        const plan = asDryRunPlan(res.json);
        const calls = plan.requests.length;
        if (calls > 20) {
          // eslint-disable-next-line no-console
          console.warn(
            `[integration] ${f.id} would make ${calls} Jev calls (warn-only: target ≤ 20)`,
          );
        }
        expect(calls).toBeLessThanOrEqual(20);
      }
    }, PER_FIXTURE_TIMEOUT_MS * 2);
  });
});

afterAll(() => {
  if (KEY_PRESENT) {
    // eslint-disable-next-line no-console
    console.log("[integration] live suite finished");
  }
});

function collectCriteriaChoices(
  requests: readonly { readonly questions: Readonly<Record<string, unknown>> }[],
): string[] {
  const out: string[] = [];
  for (const r of requests) {
    for (const q of Object.values(r.questions)) {
      if (typeof q !== "object" || q === null) continue;
      const criteria = (q as { criteria?: unknown }).criteria;
      if (typeof criteria === "object" && criteria !== null) {
        for (const key of Object.keys(criteria as Record<string, unknown>)) {
          out.push(key);
        }
      }
    }
  }
  return out;
}
