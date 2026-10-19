import type { OrgContext } from "@/lib/auth/server";
import type { ApiLookupPosition } from "@/data-access/api-lookup-filters";

export interface ReadListQuery<Filters> {
  filters: Filters;
  limit: number;
  cursor?: ApiLookupPosition;
}

/** Transport-neutral page: adapters encode the next position for their clients. */
export async function readListPage<Filters, Row extends { id: string; cursorCreatedAt: string }, Output>(
  ctx: OrgContext, query: ReadListQuery<Filters>,
  list: (ctx: OrgContext, filters: Filters, limit: number, cursor?: ApiLookupPosition) => Promise<Row[]>,
  represent: (row: NoInfer<Row>) => Output,
) {
  const rows = await list(ctx, query.filters, query.limit, query.cursor);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    data: page.map(represent),
    nextPosition: rows.length > query.limit && last ? { id: last.id, createdAt: last.cursorCreatedAt } : null,
  };
}
