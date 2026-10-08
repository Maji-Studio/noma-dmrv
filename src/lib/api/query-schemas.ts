import { z } from "zod";
import { API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_QUERY_MAX_LENGTH } from "@/config/api-rest";

const pageLimitSchema = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().max(API_LIST_MAX_LIMIT)).optional().default(API_LIST_DEFAULT_LIMIT)
  .describe(`Page size as a decimal integer string; defaults to ${API_LIST_DEFAULT_LIMIT}, maximum ${API_LIST_MAX_LIMIT}.`);
const cursorSchema = z.string().optional().describe("Opaque continuation cursor bound to organization, resource and filters.");
const facilityIdSchema = z.uuid().optional().describe("Receiving facility filter, UUID.");
const prefixSchema = z.string().max(API_QUERY_MAX_LENGTH).optional();
const codeSchema = z.string().max(API_QUERY_MAX_LENGTH).optional().describe("Exact human-readable resource code.");
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
export const feedstockListSchema = z.strictObject({
  limit: pageLimitSchema,
  facilityId: facilityIdSchema,
  q: prefixSchema.describe("Case-insensitive literal prefix search on feedstock code."),
  code: codeSchema,
  cursor: cursorSchema,
});
