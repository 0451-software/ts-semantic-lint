/**
 * Vitest tests for the public package entry — `src/index.ts`.
 *
 * Verifies that the documented re-exports from the brief light up:
 *   - `load`, `loadFromDiscovery`, `Config`, `DEFAULT_MODEL`
 *   - `JevClient`
 *   - `extractTargets`
 *   - `evaluateRule`
 *   - `runCli`, `parseArgv`, `ExitCode`
 *
 * Runner / output re-exports are probed but not asserted — those
 * modules may not be merged at the moment this PR lands.
 */
import { describe, expect, it } from "vitest";

import * as entry from "./index.js";

describe("public package entry", () => {
  it("re-exports config foundation", () => {
    expect(typeof entry.load).toBe("function");
    expect(typeof entry.loadFromDiscovery).toBe("function");
    expect(typeof entry.Config).toBe("function");
    expect(entry.DEFAULT_MODEL).toBe("jev-latest");
  });

  it("re-exports the Jev client", () => {
    expect(typeof entry.JevClient).toBe("function");
  });

  it("re-exports the analyzer entry point", () => {
    expect(typeof entry.extractTargets).toBe("function");
  });

  it("re-exports the policy evaluator", () => {
    expect(typeof entry.evaluateRule).toBe("function");
  });

  it("re-exports the CLI surface", () => {
    expect(typeof entry.runCli).toBe("function");
    expect(typeof entry.parseArgv).toBe("function");
    expect(entry.ExitCode).toMatchObject({
      Success: 0,
      HasIssues: 1,
      OperationalError: 2,
    });
  });

  it("exposes the buffer stream helper for testing", () => {
    expect(typeof entry.BufferStream).toBe("function");
    expect(typeof entry.createBufferStreams).toBe("function");
  });

  it("extractTargets + evaluateRule round-trip on a fixture", () => {
    const src = "export function add(a: number, b: number): number { return a + b; }";
    const targets = entry.extractTargets(src, "/abs/sample.ts");
    expect(targets.length).toBeGreaterThan(0);
    const fn = targets.find((t) => t.kind === "function" || t.kind === "FunctionDeclaration");
    expect(fn).toBeDefined();
    if (!fn) throw new Error("unreachable");
    const answer: import("./types.js").JevAnswer = {
      choice: "no",
      confidence: 0.9,
      probabilities: { yes: 0.1, no: 0.9 },
    };
    const rule = {
      id: "test-rule",
      selector: { kind: "function" },
      diagnostics: [
        {
          when: { choice: "no" },
          level: "warn" as const,
          message: "rule fired",
        },
      ],
    };
    const diag = entry.evaluateRule(rule, fn, answer, undefined);
    expect(diag).not.toBeNull();
    expect(diag?.level).toBe("warn");
  });
});
