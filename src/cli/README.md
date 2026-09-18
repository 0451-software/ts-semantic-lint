# ts-semantic-lint CLI

The `ts-semantic-lint` command wraps `commander` to parse argv, then
dispatches to the runner + output + config modules. It mirrors the
behavior of `erislint`'s `src/main.rs`.

## Usage

```text
ts-semantic-lint [options] [paths...]
```

## Flags

| Flag | Behavior |
|------|----------|
| `[paths...]` | Files / directories to lint. Defaults to scanning the config directory. |
| `--config <path>` | Override config discovery. Skips walking up from `cwd` to find `ts-semantic-lint.json`. |
| `--check-config` | Validate + exit, no lint. Prints `Configuration valid: N rules (<path>)` on success. |
| `--dry-run` | Print Jev requests as JSON to stdout, no network calls. |
| `--format <text\|json>` | Diagnostic output format. Default: `text`. `compact` is reserved for a later batch. |
| `--errors-only` | Hide warnings from output. The exit-status rules still apply to the full run. |
| `--deny-warnings` | Exit 1 when warnings are present (in addition to the default exit 1 on errors). |
| `--jobs <N>` | Concurrency for Jev requests. Default: 64. Must be a positive integer. |
| `--color <auto\|always\|never>` | Force or disable color in text output. `auto` honors `NO_COLOR` and TTY detection. |
| `--version` | Print the package version, exit 0. |
| `--help` | Print usage, exit 0. |

## Environment

- **`jev_key`** (exact case) — the TypeSafe API key. `.env` is NOT
  auto-loaded. A real lint run without `jev_key` exits 2 with a
  message on stderr pointing at this variable. Use `--dry-run` to
  preview requests without a key.

- **`NO_COLOR`** — read by `output/ansi.ts` (you don't set it here;
  it's a passthrough to the output renderer).

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | No errors; warnings allowed. |
| `1` | Errors present, OR warnings present with `--deny-warnings`. |
| `2` | Config / parse / auth / API / operational failure. |

## Programmatic use

The CLI's parser and dispatcher are exported from `@/cli` so LSP
servers, CI runners, and other embedders can drive the CLI without
spawning a child process:

```ts
import { runCli, createDefaultStreams } from "ts-semantic-lint";

const exitCode = await runCli({
  argv: process.argv.slice(2),
  streams: createDefaultStreams(),
  cwd: process.cwd(),
  env: process.env,
  version: "0.1.0",
});
process.exit(exitCode);
```

Or, for tests, with buffer-backed streams:

```ts
import { runCli, createBufferStreams } from "ts-semantic-lint";

const { streams, stdout, stderr } = createBufferStreams();
const code = await runCli({
  argv: ["--check-config"],
  streams,
  cwd: "/path/to/project",
  env: {},
  version: "0.1.0",
});
expect(code).toBe(0);
expect(stdout.text()).toContain("Configuration valid");
```

## Deferred flags

The following flags are deferred to the polish batch and not yet
accepted:

- `--schema <config\|rule>` — print JSON Schema for the config or
  rule-file shape.
- `--all-answers` — include every option's probability in text output.
- `--format compact` — terse single-line format.
- `--stdin-file <path>` — read an unsaved snapshot from stdin.
- `--target-start <offset>` — restrict evaluation to the function
  whose declaration token starts at the given UTF-8 byte offset
  (requires `--stdin-file`).
