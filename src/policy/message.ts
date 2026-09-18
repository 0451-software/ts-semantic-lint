/**
 * Message formatting — substitute `{name}` / `{kind}` / `{file}` placeholders
 * in a template string with fields from the target.
 *
 * Unknown placeholders are left verbatim so users can see typos in their
 * templates instead of silently swallowing them. The substitution is a
 * single-pass replace; it does not try to handle nested or escaped braces.
 *
 * Supported placeholders:
 * - `{name}` — target.name (empty string if undefined)
 * - `{kind}` — target.kind
 * - `{file}` — target.file
 */
import type { LintedTarget } from "../types.js";

const PLACEHOLDERS = ["name", "kind", "file"] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

function valueFor(target: LintedTarget, key: Placeholder): string {
  switch (key) {
    case "name":
      return target.name ?? "";
    case "kind":
      return target.kind;
    case "file":
      return target.file;
  }
}

export function formatMessage(template: string, target: LintedTarget): string {
  let out = template;
  for (const key of PLACEHOLDERS) {
    out = out.split(`{${key}}`).join(valueFor(target, key));
  }
  return out;
}
