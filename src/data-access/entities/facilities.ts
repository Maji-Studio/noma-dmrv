/**
 * Facility options for searchable entity selection.
 */

import { ilike, or, eq, and, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getFacilities(ctx: OrgContext, params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, limit } = params;

  const conditions: SQL[] = [isNull(facilities.archivedAt)];
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(facilities.code, searchPattern),
        ilike(facilities.name, searchPattern),
        ilike(facilities.location, searchPattern)
      )!
    );
  }
  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      location: facilities.location,
    })
    .from(facilities)
    .where(and(eq(facilities.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.location ?? undefined,
  }));
}

export async function getFacilityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      location: facilities.location,
    })
    .from(facilities)
    .where(and(eq(facilities.id, id), eq(facilities.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.location ?? undefined,
  };
}
