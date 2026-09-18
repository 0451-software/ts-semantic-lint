/**
 * JSON-Schema generation for the `ts-semantic-lint` config file.
 *
 * Uses `zod-to-json-schema` to convert the Zod schemas in `./schemas.ts`
 * into JSON-Schema 2020-12 documents. The output is intended to be
 * published as a static asset alongside the package and referenced
 * from `$schema` in user config files for IDE completion.
 *
 * Two schemas are emitted:
 *   - `generateConfigSchema()` — full `ConfigFile` shape with all
 *     subsections.
 *   - `generateRuleSchema()` — a single `Rule` (used by `.json` files
 *     referenced from `rule_files`).
 */
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  ConfigFileSchema,
  RuleSchema,
} from "./schemas.js";

/** Target JSON Schema version — 2020-12. */
const DRAFT = "https://json-schema.org/draft/2020-12/schema" as const;

interface JsonSchemaOptions {
  readonly name: string;
  readonly description?: string;
  readonly strict?: boolean;
}

function convert(
  schema: Parameters<typeof zodToJsonSchema>[0],
  opts: JsonSchemaOptions,
): string {
  const json = zodToJsonSchema(schema, {
    name: opts.name,
    $refStrategy: "none",
    errorMessages: true,
    markdownDescription: true,
  }) as Record<string, unknown>;
  // Pin the $schema field so consumers always get draft 2020-12,
  // even if the upstream library picks something else.
  json["$schema"] = DRAFT;
  if (opts.description !== undefined) {
    json["description"] = opts.description;
  }
  return JSON.stringify(json, null, 2);
}

/** JSON-Schema document for the top-level config file. */
export function generateConfigSchema(): string {
  return convert(ConfigFileSchema, {
    name: "ConfigFile",
    description:
      "ts-semantic-lint project configuration. File patterns are relative to this file's directory.",
  });
}

/** JSON-Schema document for a single rule. */
export function generateRuleSchema(): string {
  return convert(RuleSchema, {
    name: "Rule",
    description:
      "A single linter rule: a selector that picks AST targets, a Jev Choice question, and an ordered list of diagnostic policies.",
  });
}
