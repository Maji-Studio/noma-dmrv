import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { formulationIngredients, formulations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope } from "./utils";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, type ApiLookupFilters, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

function formulationQuery(ctx: OrgContext) {
  requireOrgScope(ctx);
  return db.select({
    id: formulations.id,
    code: formulations.code,
    name: formulations.name,
    version: formulations.version,
    biocharRatio: formulations.biocharRatio,
    createdAt: formulations.createdAt,
    updatedAt: formulations.updatedAt,
    // The recipe lines ride in the same statement snapshot as the row, in recipe order.
    // Raw subquery columns stay qualified so the correlation cannot bind locally.
    lines: sql<{ id: string; feedstockTypeId: string; ratio: number | null }[]>`(
      select coalesce(json_agg(json_build_object(
        'id', line.id,
        'feedstockTypeId', line.feedstock_type_id,
        'ratio', line.ratio
      ) order by line.sort_order, line.id), '[]'::json)
      from ${formulationIngredients} as line
      where line.organization_id = ${ctx.organizationId}
        and line.formulation_id = "formulations"."id"
        and line.organization_id = "formulations"."organization_id"
    )`,
    cursorCreatedAt: lookupCursorCreatedAt(formulations.createdAt),
  }).from(formulations);
}

const notFound = () => new DomainError("not_found", "Formulation was not found.", {
  issues: [{ path: ["formulationId"], code: "not_found", message: "Formulation was not found." }],
});

export async function findApiFormulation(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const [row] = await formulationQuery(ctx).where(and(
    eq(formulations.organizationId, ctx.organizationId),
    "id" in identifier ? eq(formulations.id, identifier.id) : eq(formulations.code, identifier.code),
  )).limit(1);
  if (!row) throw notFound();
  return row;
}

/** Formulations are never archived, so every one is listed. */
export async function listApiFormulations(ctx: OrgContext, filters: ApiLookupFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  return formulationQuery(ctx).where(and(
    eq(formulations.organizationId, ctx.organizationId),
    filters.code === undefined ? undefined : eq(formulations.code, filters.code),
    lookupSearch(formulations, filters.q), lookupPosition(formulations, cursor),
  )).orderBy(desc(formulations.createdAt), desc(formulations.id)).limit(limit + 1);
}
