import { z } from "zod";
import { findApiFeedstock, listApiFeedstocks } from "@/data-access/api-feedstocks";
import type { ApiContext } from "@/lib/auth/api-context";
import { decodeCursor, encodeCursor } from "./cursor";
import { parseApiQuery } from "./query";
import { representFeedstock } from "./representations/feedstocks";
import { feedstockListSchema } from "./query-schemas";

export async function readFeedstockList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, feedstockListSchema);
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
