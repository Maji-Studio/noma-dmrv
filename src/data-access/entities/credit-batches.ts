/**
 * Credit-batch options for searchable entity selection.
 */

import { ilike, or, eq, and, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, facilities } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getCreditBatchesEntity(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [];

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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.code,
    subtitle: [r.facilityName, r.status].filter(Boolean).join(" · "),
  }));
}

export async function getCreditBatchEntityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .where(eq(creditBatches.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.code,
    subtitle: [result.facilityName, result.status].filter(Boolean).join(" · "),
  };
}
