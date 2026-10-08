import { z } from "zod";
import { API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT, API_QUERY_MAX_LENGTH } from "@/config/api-rest";
import { findApiFeedstock, listApiFeedstocks } from "@/data-access/api-feedstocks";
import type { ApiContext } from "@/lib/auth/api-context";
import { decodeCursor, encodeCursor } from "./cursor";
import { parseApiQuery } from "./query";
import { representFeedstock } from "./representations/feedstocks";

const listSchema = z.strictObject({
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(API_LIST_MAX_LIMIT)).optional().default(API_LIST_DEFAULT_LIMIT),
  facilityId: z.uuid().optional(), q: z.string().max(API_QUERY_MAX_LENGTH).optional(),
  code: z.string().max(API_QUERY_MAX_LENGTH).optional(), cursor: z.string().optional(),
});

export async function readFeedstockList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, listSchema);
  const binding = { organizationId: ctx.organizationId, resource: "feedstocks", filters };
  const position = cursor === undefined ? undefined : decodeCursor(cursor, binding);
  const rows = await listApiFeedstocks(ctx, filters, limit, position);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map(representFeedstock),
    nextCursor: rows.length > limit && last
      ? encodeCursor({ id: last.id, createdAt: last.cursorCreatedAt }, binding) : null,
  };
}

export async function readFeedstock(ctx: ApiContext, idOrCode: string) {
  const identifier = z.uuid().safeParse(idOrCode).success ? { id: idOrCode } : { code: idOrCode };
  return representFeedstock(await findApiFeedstock(ctx, identifier));
}
