import { z } from "zod";
import { API_CURSOR_MAX_LENGTH, API_IDEMPOTENCY_KEY_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { IDEMPOTENCY_RETENTION_DAYS } from "@/config/operations";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { IDEMPOTENCY_KEY_PATTERN } from "../request-body";
import { API_CURSOR_PATTERN } from "../input-text";
import { STRONG_ETAG_PATTERN } from "../etag";

export function outputSchema(schema: z.ZodType, representations: Record<string, z.ZodType> = {}): JsonSchema {
  const root: z.core.$ZodType = schema;
  const names = new Map<z.core.$ZodType, string>(Object.entries(representations).map(([name, value]) => [value, name]));
  const result: JsonSchema = z.toJSONSchema(schema, {
    io: "output",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema === root) return;
      // .describe() clones a schema; follow its metadata parent to the component.
      let candidate: z.core.$ZodType | undefined = zodSchema;
      while (candidate) {
        const name = names.get(candidate);
        if (name) {
          const description = jsonSchema.description;
          for (const key of Object.keys(jsonSchema)) delete (jsonSchema as JsonSchema)[key];
          Object.assign(jsonSchema, { $ref: `#/components/schemas/${name}`, ...(description ? { description } : {}) });
          return;
        }
        candidate = candidate._zod.parent;
      }
    },
  });
  delete result.$schema;
  return result;
}

export function queryParameters(schema: z.ZodType) {
  const generated = z.toJSONSchema(schema, { io: "input" });
  return Object.entries(generated.properties ?? {}).map(([name, field]) => {
    if (typeof field === "boolean") throw new Error("Query parameters must have concrete schemas.");
    // Input conversion loses post-transform bounds; publish the canonical page size.
    const wire: JsonSchema = name === "limit"
      ? { description: field.description, type: "integer", minimum: 1, maximum: API_LIST_MAX_LIMIT, default: API_LIST_DEFAULT_LIMIT }
      : { ...field };
    // Cursor length is enforced by decodeCursor rather than the query schema.
    if (name === "cursor") Object.assign(wire, { minLength: 1, maxLength: API_CURSOR_MAX_LENGTH, pattern: API_CURSOR_PATTERN.source });
    return { name, in: "query", required: generated.required?.includes(name) ?? false, description: wire.description, schema: wire };
  });
}

export const targetParameter = (uuidOnly = false) => ({
  name: "idOrCode", in: "path", required: true,
  description: uuidOnly ? "Target identifier, UUID; codes are not accepted on this method." : "Resource UUID or exact human-readable code.",
  schema: { type: "string", ...(uuidOnly ? { format: "uuid" } : {}) },
});
export const idempotencyParameter = (required: boolean) => ({
  name: "Idempotency-Key", in: "header", required,
  description: `Unique key per intended write, 1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters. Reuse on retry; credential-scoped, retained for ${IDEMPOTENCY_RETENTION_DAYS} days. ${required ? "Required on every create, including dry runs; a dry run never consumes it." : "Optional on this method."} Dry runs never consume or replay keys.`,
  schema: { type: "string", minLength: 1, maxLength: API_IDEMPOTENCY_KEY_MAX_LENGTH, pattern: IDEMPOTENCY_KEY_PATTERN.source },
});
export const ifMatchParameter = {
  name: "If-Match", in: "header", required: true,
  description: `One strong ETag from the resource read: "version.revision", each a positive decimal safe integer (1 to ${Number.MAX_SAFE_INTEGER}), without leading zeros, for example "3.1". Wildcards and weak tags are refused. A mismatch returns the current representation.`,
  schema: { type: "string", pattern: STRONG_ETAG_PATTERN.source },
};

const header = (description: string, schema: JsonSchema = { type: "string" }) => ({ description, schema: { description, ...schema } });
const privateHeaderDefinitions = {
  "X-Request-Id": header("Request correlation identifier, UUID.", { type: "string", format: "uuid" }),
  "RateLimit-Limit": header("Request capacity of the tightest rate-limit bucket, integer encoded as decimal text."),
  "RateLimit-Remaining": header("Remaining requests in the tightest bucket, integer encoded as decimal text."),
  "RateLimit-Reset": header("Seconds until the bucket refills, integer encoded as decimal text."),
};
const etagDefinition = { ETag: header('Strong row-version and representation-revision tag, for example "3.1".', { type: "string", pattern: STRONG_ETAG_PATTERN.source }) };
const writeHeaderDefinitions = {
  "Idempotent-Replayed": header("true when returning a previously committed outcome.", { type: "string", enum: ["true"] }),
  "Dry-Run": header("true when validation and domain guards ran but the transaction rolled back.", { type: "string", enum: ["true"] }),
};
const locationDefinition = { Location: header("Relative URL of the first created feedstock; absent on dry runs.") };

export const headerComponents = {
  ...privateHeaderDefinitions, ...etagDefinition, ...writeHeaderDefinitions, ...locationDefinition,
  "WWW-Authenticate": header("Bearer authentication challenge."),
  "Retry-After": header("Seconds to wait before retrying; present on rate limits and idempotency_in_progress."),
};
function headerReferences(definitions: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(definitions).map((name) => [name, { $ref: `#/components/headers/${name}` }]));
}
export const privateHeaders = headerReferences(privateHeaderDefinitions);
export const requestIdHeader = { "X-Request-Id": privateHeaders["X-Request-Id"] };
export const etagHeader = headerReferences(etagDefinition);
export const writeHeaders = headerReferences(writeHeaderDefinitions);
export const locationHeader = headerReferences(locationDefinition);

const errorDescriptions: Record<number, string> = {
  400: "Malformed JSON, invalid query/header syntax, or missing create idempotency key, as applicable.",
  401: "Missing, invalid, expired or revoked bearer credential, or invalid credential owner.",
  403: "Insufficient scope/role or organization API access disabled.",
  404: "Target or referenced resource absent or outside the credential organization.",
  409: "Business conflict, idempotency in progress, used dry-run key, or replay unavailable.",
  412: "Stale row version or representation revision; current contains the latest representation.",
  413: "JSON request exceeds the configured body limit.",
  415: "JSON body requires Content-Type: application/json.",
  422: "Invalid input, unknown property, unresolved reference, or key reused with a different payload.",
  428: "If-Match is missing, weak or a wildcard; send one strong resource ETag.",
  429: "Rate limited; retry after Retry-After seconds.",
  500: "Sanitized server failure. Retryable deadline or unknown outcomes require retrying with the same idempotency key.",
  503: "API writes temporarily disabled; retryable.",
};
export function problemResponseComponents() {
  const statuses = Object.keys(errorDescriptions).map(Number);
  return Object.fromEntries(statuses.map((status) => [`Problem${status}`, {
    description: errorDescriptions[status],
    headers: {
      ...privateHeaders,
      ...(status === 401 ? headerReferences({ "WWW-Authenticate": true }) : {}),
      ...([409, 429].includes(status) ? headerReferences({ "Retry-After": true }) : {}),
    },
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  }]));
}
export function problemResponses(statuses: number[]) {
  return Object.fromEntries(statuses.map((status) => [String(status), { $ref: `#/components/responses/Problem${status}` }]));
}
export function jsonResponse(description: string, schema: JsonSchema, headers: Record<string, unknown> = {}) {
  return { description, headers: { ...privateHeaders, ...headers }, content: { "application/json": { schema } } };
}
