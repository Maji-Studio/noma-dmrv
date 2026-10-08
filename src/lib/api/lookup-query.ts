import { z } from "zod";
import { API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_QUERY_MAX_LENGTH } from "@/config/api-rest";
import type { ApiContext } from "@/lib/auth/api-context";
import { decodeCursor, encodeCursor, type CursorPosition } from "./cursor";
import { parseApiQuery } from "./query";

const paginationShape = {
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(API_LIST_MAX_LIMIT)).optional().default(API_LIST_DEFAULT_LIMIT),
  cursor: z.string().optional(),
};
export const lookupListSchema = z.strictObject({
  ...paginationShape, q: z.string().max(API_QUERY_MAX_LENGTH).optional(), code: z.string().max(API_QUERY_MAX_LENGTH).optional(),
});
export const facilityLookupListSchema = lookupListSchema.extend({ facilityId: z.uuid().optional() });
export const supplierLocationListSchema = z.strictObject({ ...paginationShape, q: z.string().max(API_QUERY_MAX_LENGTH).optional() });
export const lookupGetSchema = z.strictObject({});
export const facilityLookupGetSchema = z.strictObject({ facilityId: z.uuid().optional() });

export function lookupIdentifier(idOrCode: string) {
  return z.uuid().safeParse(idOrCode).success ? { id: idOrCode } : { code: idOrCode };
}

export async function readLookupPage<Filters extends Record<string, string | undefined>, Output>(
  ctx: ApiContext, resource: string, query: { filters: Filters; limit: number; cursor?: string },
  read: (ctx: ApiContext, query: { filters: Filters; limit: number; cursor?: CursorPosition }) => Promise<{ data: Output[]; nextPosition: CursorPosition | null }>,
) {
  const { limit, cursor, filters } = query;
  const binding = { organizationId: ctx.organizationId, resource, filters };
  const position = cursor === undefined ? undefined : decodeCursor(cursor, binding);
  const page = await read(ctx, { filters, limit, cursor: position });
  return { data: page.data, nextCursor: page.nextPosition ? encodeCursor(page.nextPosition, binding) : null };
}

export { parseApiQuery };
