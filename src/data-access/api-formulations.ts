import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { formulationIngredients, formulations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { lookupCursorCreatedAt, lookupPosition, lookupSearch, type ApiLookupFilters, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

function formulationQuery(ctx: OrgContext, executor: Executor) {
  requireOrgScope(ctx);
  return executor.select({
    id: formulations.id,
    code: formulations.code,
    name: formulations.name,
    description: formulations.description,
    archivedAt: formulations.archivedAt,
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

export async function findApiFormulation(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await formulationQuery(ctx, executor).where(and(
    eq(formulations.organizationId, ctx.organizationId),
    "id" in identifier ? eq(formulations.id, identifier.id) : eq(formulations.code, identifier.code),
  )).limit(1);
  if (!row) throw notFound();
  return row;
}

export type ApiFormulationFilters = ApiLookupFilters & { archived?: boolean };
export async function listApiFormulations(ctx: OrgContext, filters: ApiFormulationFilters, limit: number, cursor?: ApiLookupPosition, executor: Executor = db) {
  requireOrgScope(ctx);
  return formulationQuery(ctx, executor).where(and(
    eq(formulations.organizationId, ctx.organizationId),
    filters.archived ? isNotNull(formulations.archivedAt) : isNull(formulations.archivedAt),
    filters.code === undefined ? undefined : eq(formulations.code, filters.code),
    lookupSearch(formulations, filters.q), lookupPosition(formulations, cursor),
  )).orderBy(desc(formulations.createdAt), desc(formulations.id)).limit(limit + 1);
}
