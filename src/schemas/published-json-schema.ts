/**
 * What a schema advertises in a generated contract (OpenAPI, MCP tool input).
 *
 * Zod stays the runtime authority. JSON Schema generation reads only a pipe's
 * input side and cannot express a transform, so a few shared helpers either
 * attach their canonical bounds as metadata (`pipeToCanonicalNumber`) or name
 * the exact JSON Schema they accept here. `toOperationJsonSchema` swaps a
 * registered schema's generated output for this one.
 */

import { z } from "zod";

export interface PublishedJsonSchema {
  jsonSchema: Record<string, unknown>;
}

export const publishedJsonSchemas = z.registry<PublishedJsonSchema>();

/** Number keywords a canonical schema carries into a published contract. */
const NUMBER_BOUND_KEYWORDS = [
  "minimum",
  "exclusiveMinimum",
  "maximum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

type NumberBounds = Partial<
  Record<(typeof NUMBER_BOUND_KEYWORDS)[number], number>
>;

function collectNumberBounds(node: unknown, bounds: NumberBounds): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const keyword of NUMBER_BOUND_KEYWORDS) {
    const value = record[keyword];
    if (typeof value === "number" && bounds[keyword] === undefined) {
      bounds[keyword] = value;
    }
  }
  const branches = record.anyOf;
  if (Array.isArray(branches)) {
    for (const branch of branches) collectNumberBounds(branch, bounds);
  }
}

/**
 * The bounds of a canonical number schema, read from its own generated JSON
 * Schema so each rule value stays defined once, in the Zod chain.
 */
export function numberBoundsOf(canonical: z.ZodType): NumberBounds {
  const bounds: NumberBounds = {};
  collectNumberBounds(
    z.toJSONSchema(canonical, { io: "output", unrepresentable: "any" }),
    bounds,
  );
  return bounds;
}
