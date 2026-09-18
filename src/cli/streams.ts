/**
 * stdout / stderr abstraction for the CLI.
 *
 * The CLI never calls `console.log` or `process.stdout.write` directly.
 * Instead it writes through the `Streams` interface passed in. This lets
 * tests capture output into in-memory buffers and inspect it.
 *
 * In production, `createDefaultStreams()` returns wrappers around
 * `process.stdout` / `process.stderr` that preserve Node's normal
 * behaviour (including TTY detection, used by the `--color auto` flag).
 */
import { stderr, stdout } from "node:process";
import type { WriteStream } from "node:tty";

/**
 * A minimal write surface — the only thing the CLI ever does with
 * stdout / stderr is append a string. `Buffer` is not used because all
 * CLI output is UTF-8 text (JSON, help text, etc.).
 */
export interface StreamLike {
  write(chunk: string): boolean;
  /** True when the stream is attached to a terminal. Defaults to false. */
  readonly isTTY: boolean;
}

/**
 * Bundle handed to every command implementation.
 *
 * Both streams default to a buffer-backed implementation in tests so a
 * test that forgets to inject one doesn't accidentally write to the
 * real process stdout.
 */
export interface Streams {
  readonly stdout: StreamLike;
  readonly stderr: StreamLike;
}

/**
 * Construct the production `Streams` wrapping `process.stdout` and
 * `process.stderr`. The `isTTY` flag is read at call time so piping
 * (which changes the flag after startup) is reflected correctly.
 */
export function createDefaultStreams(): Streams {
  return {
    stdout: wrapStream(stdout),
    stderr: wrapStream(stderr),
  };
}

function wrapStream(s: WriteStream): StreamLike {
  return {
    write(chunk: string): boolean {
      return s.write(chunk);
    },
    get isTTY(): boolean {
      return s.isTTY === true;
    },
  };
}

/**
 * In-memory `StreamLike` implementation used by tests. Writes are
 * appended to a public `chunks` array as plain strings; `isTTY`
 * defaults to `false` but can be overridden per-instance.
 */
export class BufferStream implements StreamLike {
  readonly chunks: string[] = [];
  isTTY: boolean = false;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  /** Concatenate everything written so far. */
  text(): string {
    return this.chunks.join("");
  }
}

/**
 * Build a `Streams` bundle where both `stdout` and `stderr` point at
 * fresh `BufferStream` instances.
 */
export function createBufferStreams(): {
  streams: Streams;
  stdout: BufferStream;
  stderr: BufferStream;
} {
  const stdoutBuf = new BufferStream();
  const stderrBuf = new BufferStream();
  return {
    streams: { stdout: stdoutBuf, stderr: stderrBuf },
    stdout: stdoutBuf,
    stderr: stderrBuf,
  };
}
