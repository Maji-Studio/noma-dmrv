/**
 * Credit-batch options for searchable entity selection.
 */

import { ilike, or, eq, and, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, facilities } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getCreditBatchesEntity(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [isNull(creditBatches.archivedAt)];

  if (facilityId) {
    conditions.push(eq(creditBatches.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(creditBatches.code, searchPattern),
        ilike(creditBatches.registry, searchPattern)
      )!
    );
  }

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(
      facilities,
      and(
        eq(creditBatches.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.code,
    subtitle: [r.facilityName, r.status].filter(Boolean).join(" · "),
  }));
}

export async function getCreditBatchEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(
      facilities,
      and(
        eq(creditBatches.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(creditBatches.id, id), eq(creditBatches.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.code,
    subtitle: [result.facilityName, result.status].filter(Boolean).join(" · "),
  };
}
