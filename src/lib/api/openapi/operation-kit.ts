import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { toOperationJsonSchema, type JsonSchema } from "@/lib/operations/json-schema";
import type { ApiScope } from "@/lib/auth/api-scopes";

export interface OperationDocument {
  operationId: string;
  description: string;
  "x-required-scope": ApiScope | null;
  security?: { bearerAuth: never[] }[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}
export type Paths = Record<string, Record<string, OperationDocument>>;

export function privateOperation(operationId: string, scope: ApiScope | undefined, description: string, responses: Record<string, unknown>, parameters: unknown[] = []): OperationDocument {
  return { operationId, description: `${description} Required scope: ${scope ?? "none (any authenticated API key)"}.`, "x-required-scope": scope ?? null, parameters, responses };
}
export function operationInput(schema: Parameters<typeof toOperationJsonSchema>[0]): JsonSchema {
  const result = toOperationJsonSchema(schema);
  delete result.$schema;
  // REST rejects unknown keys recursively, while forms retain their stripping behavior.
  function close(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(close);
    const record = node as JsonSchema;
    if (record.properties) record.additionalProperties = false;
    Object.values(record).forEach(close);
  }
  close(result);
  return result;
}
export const requestBody = (schema: JsonSchema, example: unknown) => ({ required: true, description: `JSON body, maximum ${API_BODY_MAX_BYTES} bytes. Unknown properties are rejected.`, content: { "application/json": { schema, example } } });
