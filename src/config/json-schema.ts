/**
 * JSON-Schema generation for the `ts-semantic-lint` config file.
 *
 * Uses Zod 4's native `z.toJSONSchema()` (introduced in zod@4.0) to
 * convert the Zod schemas in `./schemas.ts` into JSON-Schema 2020-12
 * documents. The output is intended to be published as a static asset
 * alongside the package and referenced from `$schema` in user config
 * files for IDE completion.
 *
 * Two schemas are emitted:
 *   - `generateConfigSchema()` — full `ConfigFile` shape with all
 *     subsections.
 *   - `generateRuleSchema()` — a single `Rule` (used by `.json` files
 *     referenced from `rule_files`).
 *
 * ### Migration from `zod-to-json-schema`
 *
 * Replaces the deprecated `zod-to-json-schema@3.25.2` (whose README now
 * recommends Zod 4's native converter and which only accepts Zod v3
 * schemas via `zod/v3`). Option mapping:
 *
 * | `zod-to-json-schema` option | Zod 4 equivalent |
 * |---|---|
 * | `name: "Foo"` | `opts.id` here; the id is applied as the `definitions` key in the legacy envelope (no per-schema registration needed because we wrap manually). |
 * | `$refStrategy: "none"` | `reused: "inline"` (Zod 4's default — kept explicit for clarity). |
 * | `errorMessages: true` | Zod 4 propagates custom error messages attached via `.refine({ message })` into the emitted JSON Schema by default. |
 * | `markdownDescription: true` | Zod 4 doesn't expose a `markdownDescription` toggle — descriptions registered via `.meta({ description })` end up in the standard JSON Schema `description` field. The non-standard `markdownDescription` field from `zod-to-json-schema` was a vendor extension that no consumer in this repo relies on; dropping it is a deliberate cleanup. |
 *
 * The output is wrapped into a `{ $ref, definitions }` envelope to
 * match the legacy `zod-to-json-schema` shape so downstream consumers
 * (IDE `$schema` users, the unit test that asserts on `definitions`)
 * see no change.
 */
import { z } from "zod";

import { ConfigFileSchema, RuleSchema } from "./schemas.js";

/** Target JSON Schema version — 2020-12. */
const DRAFT = "https://json-schema.org/draft/2020-12/schema" as const;

interface JsonSchemaOptions {
  readonly id: string;
  readonly description?: string;
}

/**
 * Convert a single Zod schema into a JSON Schema 2020-12 document and
 * wrap it in a `{ $ref, definitions }` envelope so the output shape
 * matches the legacy `zod-to-json-schema` output byte-for-byte.
 *
 * `@param schema` is the top-level Zod schema to convert.
 * `@param opts.id` is the canonical name under which to register the
 *   schema (the `name:` option in `zod-to-json-schema`).
 */
function convert(schema: z.ZodType, opts: JsonSchemaOptions): string {
  const json = z.toJSONSchema(schema, {
    // Match `$refStrategy: "none"` for reused schemas — never extract
    // reused schemas into `$defs`. This is Zod 4's default, kept
    // explicit so the intent is grep-able.
    reused: "inline",
    // The recursive `ConditionSchema` (used inside `diagnostics[*].when`)
    // has self-referential `all`/`any` arrays. Use `"ref"` so Zod 4
    // breaks the cycle by extracting the recursive schema into `$defs`
    // and using `$ref` at the recursion site. The downstream `definitions`
    // envelope accepts `$defs` keys unchanged — they're still under
    // `definitions` from a JSON-Schema-validation standpoint.
    cycles: "ref",
    // Use "input" mode so Zod 4's pipe processor unwraps `.transform()`
    // calls (e.g. `.string().transform(s => s.trim())`) to their input
    // type instead of throwing "Transforms cannot be represented in
    // JSON Schema". The legacy `zod-to-json-schema` library used the
    // same convention — transforms were represented by their source
    // schema. Output mode would throw on every `.transform()` field.
    //
    // Side effect: in input mode, fields with `.default(...)` that are
    // otherwise optional are NOT marked `required` in the emitted JSON
    // Schema. That's actually semantically correct for a user-facing
    // config schema (the user can omit them; the default applies at
    // parse time).
    io: "input",
  }) as Record<string, unknown>;

  // Pin the $schema field so consumers always get draft 2020-12,
  // even if the upstream library picks something else.
  json["$schema"] = DRAFT;
  if (opts.description !== undefined) {
    json["description"] = opts.description;
  }

  // Wrap into the legacy `{ $ref, definitions }` envelope so the
  // document is self-contained and matches what `zod-to-json-schema`
  // used to emit. The test suite asserts on `definitions["ConfigFile"]`;
  // downstream consumers may use the top-level `$ref` as a stable entry
  // point.
  //
  // Zod 4 may emit a nested `$defs` block INSIDE the schema body when
  // `cycles: "ref"` extracts a recursive schema (e.g. `ConditionSchema`).
  // The `$ref` strings inside that body point to `#/$defs/<name>`, which
  // is the ROOT `$defs` keyword in JSON Schema 2020-12. Hoist any
  // nested `$defs` to the envelope's `$defs` so the refs resolve.
  const nestedDefs = (json as Record<string, unknown>)["$defs"];
  const wrapped: Record<string, unknown> = {
    $schema: DRAFT,
    $ref: `#/definitions/${opts.id}`,
    definitions: {
      [opts.id]: json,
    },
    description: opts.description,
  };
  if (nestedDefs !== undefined && typeof nestedDefs === "object") {
    // Drop the nested $defs from the schema body so we don't duplicate
    // the entries at two levels (which would confuse consumers).
    delete (json as Record<string, unknown>)["$defs"];
    wrapped["$defs"] = nestedDefs;
  }

  return JSON.stringify(wrapped, null, 2);
}

/** JSON-Schema document for the top-level config file. */
export function generateConfigSchema(): string {
  return convert(ConfigFileSchema, {
    id: "ConfigFile",
    description:
      "ts-semantic-lint project configuration. File patterns are relative to this file's directory.",
  });
}

/** JSON-Schema document for a single rule. */
export function generateRuleSchema(): string {
  return convert(RuleSchema, {
    id: "Rule",
    description:
      "A single linter rule: a selector that picks AST targets, a Jev Choice question, and an ordered list of diagnostic policies.",
  });
}
