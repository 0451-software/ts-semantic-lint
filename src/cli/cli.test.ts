/**
 * Vitest tests for the CLI module — `runCli({...})` with buffer-backed
 * streams.
 *
 * The tests cover the brief's required minimums (version, help,
 * missing-config exit code, check-config, dry-run, format json,
 * default format text, missing jev_key message, --color never) plus
 * the exit-code matrix.
 *
 * The runner / output modules aren't merged yet, so `--dry-run` and
 * the lint command paths exit 2 with a "module unavailable" message
 * rather than calling the API. Once PRs #7 and #8 merge, the relevant
 * tests will exercise the real path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExitCode } from "./exit-codes.js";
import {
  BufferStream,
  createBufferStreams,
  createDefaultStreams,
} from "./streams.js";
import { parseArgv } from "./parse-argv.js";
import { runCli } from "./run-cli.js";

import type { RunCliArgs } from "./run-cli.js";

const VERSION = "9.9.9-test";
const FIXTURE_ROOT = new URL("./__fixtures__/", import.meta.url).pathname;
const VALID_CONFIG = `${FIXTURE_ROOT}ts-semantic-lint.json`;
const INVALID_CONFIG = `${FIXTURE_ROOT}ts-semantic-lint.invalid.json`;

function runArgs(
  partial: Partial<RunCliArgs> & { argv: readonly string[] },
): RunCliArgs {
  return {
    streams: partial.streams ?? createDefaultStreams(),
    cwd: partial.cwd ?? FIXTURE_ROOT,
    env: partial.env ?? {},
    version: partial.version ?? VERSION,
    argv: partial.argv,
  };
}

describe("parseArgv", () => {
  it("recognises --version", () => {
    const r = parseArgv(["--version"]);
    expect(r.kind).toBe("version");
  });

  it("recognises --help", () => {
    const r = parseArgv(["--help"]);
    expect(r.kind).toBe("help");
    if (r.kind !== "help") throw new Error("unreachable");
    expect(r.text).toContain("ts-semantic-lint");
  });

  it("returns structured options for a normal lint invocation", () => {
    const r = parseArgv(["src/lib.ts", "--format", "json"]);
    expect(r.kind).toBe("options");
    if (r.kind !== "options") throw new Error("unreachable");
    expect(r.options.paths).toEqual(["src/lib.ts"]);
    expect(r.options.format).toBe("json");
    expect(r.options.format).not.toBe("text");
  });

  it("defaults format to text", () => {
    const r = parseArgv([]);
    expect(r.kind).toBe("options");
    if (r.kind !== "options") throw new Error("unreachable");
    expect(r.options.format).toBe("text");
  });

  it("parses --color never without error", () => {
    const r = parseArgv(["--color", "never"]);
    expect(r.kind).toBe("options");
    if (r.kind !== "options") throw new Error("unreachable");
    expect(r.options.color).toBe("never");
  });

  it("rejects --format compact (deferred)", () => {
    const r = parseArgv(["--format", "compact"]);
    expect(r.kind).toBe("parseError");
  });

  it("rejects unknown --color choices", () => {
    const r = parseArgv(["--color", "rainbow"]);
    expect(r.kind).toBe("parseError");
  });

  it("rejects non-integer --jobs", () => {
    const r = parseArgv(["--jobs", "abc"]);
    expect(r.kind).toBe("parseError");
  });

  it("defaults --jobs to 64", () => {
    const r = parseArgv([]);
    expect(r.kind).toBe("options");
    if (r.kind !== "options") throw new Error("unreachable");
    expect(r.options.jobs).toBe(64);
  });
});

describe("runCli", () => {
  let buffer: {
    streams: ReturnType<typeof createBufferStreams>["streams"];
    stdout: BufferStream;
    stderr: BufferStream;
  };
  beforeEach(() => {
    buffer = createBufferStreams();
  });

  afterEach(() => {
    buffer = createBufferStreams();
  });

  it("--version prints the package version to stdout", async () => {
    const code = await runCli(
      runArgs({ argv: ["--version"], streams: buffer.streams }),
    );
    expect(code).toBe(ExitCode.Success);
    expect(buffer.stdout.text()).toBe(`${VERSION}\n`);
    expect(buffer.stderr.text()).toBe("");
  });

  it("--help prints the usage block to stdout", async () => {
    const code = await runCli(
      runArgs({ argv: ["--help"], streams: buffer.streams }),
    );
    expect(code).toBe(ExitCode.Success);
    expect(buffer.stdout.text()).toContain("ts-semantic-lint");
    expect(buffer.stdout.text()).toContain("--check-config");
    expect(buffer.stdout.text()).toContain("--dry-run");
  });

  it("--check-config succeeds (exit 0) for a valid config", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--check-config", "--config", VALID_CONFIG],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.Success);
    expect(buffer.stdout.text()).toContain("Configuration valid");
    expect(buffer.stdout.text()).toContain("1 rules");
  });

  it("--check-config exits 2 for an invalid config", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--check-config", "--config", INVALID_CONFIG],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.OperationalError);
    expect(buffer.stderr.text()).toContain("ts-semantic-lint:");
  });

  it("--check-config --format json produces valid JSON on stdout", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--check-config", "--config", VALID_CONFIG, "--format", "json"],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.Success);
    const parsed: unknown = JSON.parse(buffer.stdout.text());
    expect(parsed).toMatchObject({ valid: true, rules: 1 });
  });

  it("missing config discovery → exit 2 with stderr message", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--config", "/nonexistent/ts-semantic-lint.json"],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.OperationalError);
    expect(buffer.stderr.text()).toContain("ts-semantic-lint:");
    expect(buffer.stderr.text()).toMatch(/cannot open config|no such file/i);
  });

  it("a parse error exits 2 with stderr message", async () => {
    const code = await runCli(
      runArgs({ argv: ["--jobs", "zero"], streams: buffer.streams }),
    );
    expect(code).toBe(ExitCode.OperationalError);
    expect(buffer.stderr.text()).toContain("ts-semantic-lint:");
  });

  it("--dry-run exits 0 with the request plan on stdout", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--dry-run", "--config", VALID_CONFIG],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.Success);
    // Stdout is a JSON plan — the runner is merged, so --dry-run now works.
    const parsed: unknown = JSON.parse(buffer.stdout.text());
    expect(parsed).toMatchObject({
      requests: expect.any(Array),
      targets: expect.any(Number),
    });
  });

  it("default lint path with no jev_key exits 2 with a clear stderr message", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--config", VALID_CONFIG],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.OperationalError);
    expect(buffer.stderr.text()).toContain("jev_key");
  });

  it("--color never is accepted without error", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--check-config", "--config", VALID_CONFIG, "--color", "never"],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.Success);
  });

  it("default format is text when no --format flag", async () => {
    const code = await runCli(
      runArgs({
        argv: ["--check-config", "--config", VALID_CONFIG],
        streams: buffer.streams,
      }),
    );
    expect(code).toBe(ExitCode.Success);
    expect(buffer.stdout.text()).toContain("Configuration valid");
    expect(buffer.stdout.text()).not.toContain("{");
  });
});

describe("streams", () => {
  it("BufferStream accumulates writes and joins on text()", () => {
    const s = new BufferStream();
    s.write("hello");
    s.write(" world");
    expect(s.text()).toBe("hello world");
  });

  it("createDefaultStreams wraps process.stdout/stderr", () => {
    const s = createDefaultStreams();
    expect(typeof s.stdout.write).toBe("function");
    expect(typeof s.stderr.write).toBe("function");
  });
});
