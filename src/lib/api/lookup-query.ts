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

export async function readLookupPage<Filters extends Record<string, string | undefined>, Row extends { id: string; cursorCreatedAt: string }, Output>(
  ctx: ApiContext, resource: string, query: { filters: Filters; limit: number; cursor?: string },
  list: (ctx: ApiContext, filters: Filters, limit: number, position?: CursorPosition) => Promise<Row[]>,
  represent: (row: NoInfer<Row>) => Output,
) {
  const { limit, cursor, filters } = query;
  const binding = { organizationId: ctx.organizationId, resource, filters };
  const position = cursor === undefined ? undefined : decodeCursor(cursor, binding);
  const rows = await list(ctx, filters, limit, position);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map(represent),
    nextCursor: rows.length > limit && last
      ? encodeCursor({ id: last.id, createdAt: last.cursorCreatedAt }, binding) : null,
  };
}

export { parseApiQuery };
