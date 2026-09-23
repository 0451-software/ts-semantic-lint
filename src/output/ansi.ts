/**
 * Minimal ANSI helpers and `NO_COLOR` handling.
 *
 * Hand-rolled to keep this module dependency-free. We only emit SGR
 * (Select Graphic Rendition) sequences — enough for color/bold/underline
 * used in the Rust-style diagnostic blocks. All functions return the
 * original string unchanged when color is disabled, so callers can
 * concatenate freely.
 *
 * `NO_COLOR` (https://no-color.org/) is honored: when the env var is set
 * to any non-empty value, color is disabled regardless of other settings.
 * The `auto` mode additionally checks `process.stdout.isTTY`.
 */

export type AnsiStyle =
  "bold" | "underline" | "red" | "yellow" | "blue" | "cyan" | "magenta";

const SGR_OPEN = "\x1b[";
const SGR_RESET = "\x1b[0m";

/** Map a small set of style names to their SGR codes. */
const STYLE_CODES: Readonly<Record<AnsiStyle, readonly string[]>> = {
  bold: ["1"],
  underline: ["4"],
  red: ["31"],
  yellow: ["33"],
  blue: ["34"],
  cyan: ["36"],
  magenta: ["35"],
};

/**
 * Compose a multi-style SGR prefix. Example: `prefix(["bold", "red"])`
 * returns `"\x1b[1;31m"`.
 */
export function prefix(styles: readonly AnsiStyle[]): string {
  if (styles.length === 0) return "";
  const codes: string[] = [];
  for (const style of styles) {
    for (const code of STYLE_CODES[style]) {
      codes.push(code);
    }
  }
  return `${SGR_OPEN}${codes.join(";")}m`;
}

/**
 * Wrap a string in the given SGR styles, then close them. Returns the
 * original string unchanged when `enabled` is `false` — this is the
 * one-call shape most callers want.
 */
export function paint(
  text: string,
  styles: readonly AnsiStyle[],
  enabled: boolean,
): string {
  if (!enabled || styles.length === 0 || text.length === 0) return text;
  const open = prefix(styles);
  return `${open}${text}${SGR_RESET}`;
}

/** The raw SGR reset code, exposed for callers building multi-segment lines. */
export const RESET: string = SGR_RESET;

/** A single `AnsiStyle` prefix + reset pair, for callers that build lines incrementally. */
export function open(styles: readonly AnsiStyle[]): string {
  return prefix(styles);
}

/**
 * Returns `true` when ANSI color should be emitted.
 *
 * Rules:
 *   - `mode === "always"`  → `true`
 *   - `mode === "never"`   → `false`
 *   - `mode === "auto"`    → `true` iff stdout is a TTY AND `NO_COLOR` is unset
 *
 * `isTTY` is injected so tests can pin the TTY result without monkey-
 * patching `process.stdout`.
 */
export function colorEnabled(
  mode: "auto" | "always" | "never",
  isTTY: boolean,
  noColorEnv: string | undefined,
): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  // auto
  if (noColorEnv !== undefined && noColorEnv !== "") return false;
  return isTTY;
}
