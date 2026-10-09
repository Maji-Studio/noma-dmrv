import { PRODUCTION_RUN_STATUSES } from "@/lib/production-runs/lifecycle";
import { z } from "zod";
import { publishedJsonSchemas } from "@/schemas/published-json-schema";
import { API_CURSOR_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_QUERY_MAX_LENGTH } from "@/config/api-rest";

import { API_TEXT_PATTERN, API_CURSOR_PATTERN } from "./input-text";

const pageLimitSchema = z.preprocess((value) => typeof value === "number" ? String(value) : value, z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().max(API_LIST_MAX_LIMIT))).optional().default(API_LIST_DEFAULT_LIMIT)
  .describe(`Page size as a decimal integer string; defaults to ${API_LIST_DEFAULT_LIMIT}, maximum ${API_LIST_MAX_LIMIT}.`);
const cursorSchema = z.string().optional().describe("Opaque base64url continuation cursor bound to organization, resource and filters. Use only nextCursor from the same list and filters.");
const facilityIdSchema = z.uuid().optional().describe("Receiving facility filter, UUID.");
const prefixSchema = z.string().regex(API_TEXT_PATTERN).max(API_QUERY_MAX_LENGTH).optional();
const codeSchema = z.string().regex(API_TEXT_PATTERN).max(API_QUERY_MAX_LENGTH).optional().describe("Exact human-readable resource code.");
publishedJsonSchemas.add(pageLimitSchema, { jsonSchema: {
  type: "integer", minimum: 1, maximum: API_LIST_MAX_LIMIT, default: API_LIST_DEFAULT_LIMIT,
  description: `Page size, integer 1 to ${API_LIST_MAX_LIMIT}; defaults to ${API_LIST_DEFAULT_LIMIT}.`,
} });
publishedJsonSchemas.add(cursorSchema, { jsonSchema: { type: "string", minLength: 1, maxLength: API_CURSOR_MAX_LENGTH, pattern: API_CURSOR_PATTERN.source } });
const paginationShape = { limit: pageLimitSchema, cursor: cursorSchema };

export const lookupListSchema = z.strictObject({
  ...paginationShape,
  q: prefixSchema.describe("Case-insensitive literal prefix search on code or name."),
  code: codeSchema,
});
export const facilityLookupListSchema = lookupListSchema.extend({ facilityId: facilityIdSchema });
export const supplierLocationListSchema = z.strictObject({
  ...paginationShape,
  q: prefixSchema.describe("Case-insensitive literal prefix search on source location name."),
});
export const lookupGetSchema = z.strictObject({});
export const facilityLookupGetSchema = z.strictObject({ facilityId: facilityIdSchema });
export const feedstockListSchema = facilityLookupListSchema.extend({
  q: prefixSchema.describe("Case-insensitive literal prefix search on feedstock code."),
});

export const productionRunListSchema = z.strictObject({
  q: prefixSchema.describe("Case-insensitive literal prefix search on production run code."),
  ...paginationShape, facilityId: facilityIdSchema, code: codeSchema,
  reactorId: z.uuid().optional().describe("Reactor filter, UUID."),
  status: z.enum(PRODUCTION_RUN_STATUSES).optional().describe("Production run status filter."),
});

/** Shared by REST adapters and the public contract, without handler dependencies. */
export const resourceQueries = {
  "production-runs": { list: productionRunListSchema, get: lookupGetSchema },
  reactors: { list: facilityLookupListSchema, get: lookupGetSchema },
  feedstocks: { list: feedstockListSchema, get: lookupGetSchema },
  facilities: { list: lookupListSchema, get: lookupGetSchema },
  suppliers: { list: lookupListSchema, get: lookupGetSchema },
  "feedstock-types": { list: lookupListSchema, get: lookupGetSchema },
  "storage-locations": { list: facilityLookupListSchema, get: facilityLookupGetSchema },
  vehicles: { list: lookupListSchema, get: lookupGetSchema },
  drivers: { list: lookupListSchema, get: lookupGetSchema },
};
