/**
 * An operation schema as an MCP tool schema.
 *
 * The MCP server reads a tool's argument shape from the Standard JSON Schema
 * converter on the schema it is given. A Zod schema's own converter is plain
 * `z.toJSONSchema`, which misdescribes the form-shaped schemas (see
 * `toOperationJsonSchema`). This wrapper keeps Zod's validation and publishes
 * the corrected contract, so `tools/list` and the OpenAPI document agree.
 */

import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { toOperationJsonSchema } from "./json-schema";

export function toToolSchema<Schema extends z.ZodType>(
  schema: Schema,
): StandardSchemaWithJSON<z.input<Schema>, z.output<Schema>> {
  const zodStandard = schema["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "noma-dmrv",
      validate: (value, options) => zodStandard.validate(value, options),
      jsonSchema: {
        input: () => toOperationJsonSchema(schema, "input"),
        output: () => toOperationJsonSchema(schema, "output"),
      },
    },
  };
}
