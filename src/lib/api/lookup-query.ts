import { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { decodeCursor, encodeCursor, type CursorPosition } from "./cursor";
import { parseApiQuery } from "./query";

export { lookupListSchema, lookupGetSchema, facilityLookupListSchema, facilityLookupGetSchema, supplierLocationListSchema } from "./query-schemas";

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
