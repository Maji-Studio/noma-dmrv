/**
 * Feedstock-type options for searchable entity selection.
 */

import { and, ilike, isNull, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getFeedstockTypes(ctx: OrgContext, params: {
  search?: string;
  usage?: "pyrolysis" | "blend";
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, usage, limit } = params;

  const conditions: SQL[] = [isNull(feedstockTypes.archivedAt)];
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(feedstockTypes.code, searchPattern),
        ilike(feedstockTypes.name, searchPattern),
        ilike(feedstockTypes.category, searchPattern),
        ilike(feedstockTypes.usage, searchPattern)
      )!
    );
  }

  if (usage) {
    conditions.push(eq(feedstockTypes.usage, usage));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: feedstockTypes.id,
      code: feedstockTypes.code,
      name: feedstockTypes.name,
      category: feedstockTypes.category,
      usage: feedstockTypes.usage,
    })
    .from(feedstockTypes)
    .where(and(eq(feedstockTypes.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: `${r.category} · ${r.usage}`,
  }));
}

export async function getFeedstockTypeById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: feedstockTypes.id,
      code: feedstockTypes.code,
      name: feedstockTypes.name,
      category: feedstockTypes.category,
      usage: feedstockTypes.usage,
    })
    .from(feedstockTypes)
    .where(and(eq(feedstockTypes.id, id), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: `${result.category} · ${result.usage}`,
  };
}
