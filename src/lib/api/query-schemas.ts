import { z } from "zod";
import { publishedJsonSchemas } from "@/schemas/published-json-schema";
import { API_CURSOR_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_QUERY_MAX_LENGTH } from "@/config/api-rest";

const pageLimitSchema = z.preprocess((value) => typeof value === "number" ? String(value) : value, z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().max(API_LIST_MAX_LIMIT))).optional().default(API_LIST_DEFAULT_LIMIT)
  .describe(`Page size as a decimal integer string; defaults to ${API_LIST_DEFAULT_LIMIT}, maximum ${API_LIST_MAX_LIMIT}.`);
const cursorSchema = z.string().optional().describe("Opaque continuation cursor bound to organization, resource and filters.");
const facilityIdSchema = z.uuid().optional().describe("Receiving facility filter, UUID.");
const prefixSchema = z.string().max(API_QUERY_MAX_LENGTH).optional();
const codeSchema = z.string().max(API_QUERY_MAX_LENGTH).optional().describe("Exact human-readable resource code.");
publishedJsonSchemas.add(pageLimitSchema, { jsonSchema: {
  type: "integer", minimum: 1, maximum: API_LIST_MAX_LIMIT, default: API_LIST_DEFAULT_LIMIT,
} });
publishedJsonSchemas.add(cursorSchema, { jsonSchema: { type: "string", maxLength: API_CURSOR_MAX_LENGTH } });
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

/** Shared by REST adapters and the public contract, without handler dependencies. */
export const resourceQueries = {
  feedstocks: { list: feedstockListSchema, get: lookupGetSchema },
  facilities: { list: lookupListSchema, get: lookupGetSchema },
  suppliers: { list: lookupListSchema, get: lookupGetSchema },
  "feedstock-types": { list: lookupListSchema, get: lookupGetSchema },
  "storage-locations": { list: facilityLookupListSchema, get: facilityLookupGetSchema },
  vehicles: { list: lookupListSchema, get: lookupGetSchema },
  drivers: { list: lookupListSchema, get: lookupGetSchema },
};
