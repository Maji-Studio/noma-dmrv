import { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { decodeCursor, encodeCursor, type CursorPosition } from "./cursor";
import { parseApiQuery } from "./query";

export { lookupListSchema, lookupGetSchema, facilityLookupListSchema, facilityLookupGetSchema, supplierLocationListSchema } from "./query-schemas";

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
