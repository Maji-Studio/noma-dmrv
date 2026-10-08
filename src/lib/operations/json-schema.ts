/**
 * Published JSON Schema for an operation's input or output (OpenAPI, MCP).
 *
 * The Zod schema stays the runtime authority; this is its description. Plain
 * `z.toJSONSchema` misdescribes the form-shaped schemas in four ways, each
 * corrected here (data-entry API plan, section 3.2):
 *
 * - a schema registered in `publishedJsonSchemas` (the calendar-date decoder)
 *   is replaced by the JSON Schema it names;
 * - `z.date()` cannot be represented; on the wire it is an RFC 3339 instant;
 * - a preprocess around `.optional()` is advertised as required, because the
 *   preprocess hides the optionality. A property is required exactly when its
 *   schema rejects `undefined` at runtime;
 * - form encodings (`""` to clear a select) are runtime leniency, not the
 *   contract, so their branches are dropped.
 *
 * Refinements and cross-field rules cannot be expressed and stay documented in
 * the operation description; Zod still enforces them.
 */

import { z } from "zod";
import { publishedJsonSchemas } from "@/schemas/published-json-schema";

export type JsonSchema = Record<string, unknown>;
export type JsonSchemaIo = "input" | "output";

const INSTANT_JSON_SCHEMA: JsonSchema = { type: "string", format: "date-time" };

function replaceInPlace(target: JsonSchema, replacement: JsonSchema): void {
  const description = target.description;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(replacement));
  if (description !== undefined) target.description = description;
}

function isFormEncodingBranch(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const record = node as JsonSchema;
  return record.const === "" && (record.type === "string" || record.type === undefined);
}

/** Drop form-encoding branches and flatten the `anyOf` nesting Zod emits for `.or()` chains. */
function normalizeAnyOf(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(normalizeAnyOf);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as JsonSchema;
  for (const value of Object.values(record)) normalizeAnyOf(value);

  const branches = record.anyOf;
  if (!Array.isArray(branches)) return;
  const flattened = branches
    .flatMap((branch) => {
      const nested = (branch as JsonSchema | null)?.anyOf;
      const onlyAnyOf = branch && Object.keys(branch as JsonSchema).length === 1;
      return onlyAnyOf && Array.isArray(nested) ? nested : [branch];
    })
    .filter((branch) => !isFormEncodingBranch(branch));
  if (flattened.length === 1) {
    delete record.anyOf;
    Object.assign(record, flattened[0]);
  } else {
    record.anyOf = flattened;
  }
}

function acceptsOmission(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success;
}

/** The JSON Schema an operation publishes for `schema`. */
export function toOperationJsonSchema(
  schema: z.ZodType,
  io: JsonSchemaIo = "input",
): JsonSchema {
  const generated = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      const target = jsonSchema as JsonSchema;
      const published = publishedJsonSchemas.get(zodSchema);
      if (published) {
        replaceInPlace(target, published.jsonSchema);
        return;
      }
      const def = zodSchema._zod.def;
      if (def.type === "date") {
        replaceInPlace(target, INSTANT_JSON_SCHEMA);
        return;
      }
      if (io === "input" && def.type === "object") {
        const shape = (zodSchema as unknown as z.ZodObject).shape;
        const required = Object.keys(shape).filter(
          (key) => !acceptsOmission(shape[key] as z.ZodType),
        );
        if (required.length > 0) target.required = required;
        else delete target.required;
      }
    },
  }) as JsonSchema;

  if (io === "input") normalizeAnyOf(generated);
  return generated;
}
