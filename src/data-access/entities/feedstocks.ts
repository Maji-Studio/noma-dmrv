/**
 * Feedstock-batch options for searchable entity selection.
 */

import { ilike, eq, and, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { feedstocks, feedstockTypes } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getFeedstocks(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [isNull(feedstocks.archivedAt)];

  if (facilityId) {
    conditions.push(eq(feedstocks.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(feedstocks.code, searchPattern));
  }

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: feedstocks.id,
      code: feedstocks.code,
      massDryKg: feedstocks.massDryKg,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(feedstocks)
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.feedstockTypeName ?? r.code,
    subtitle:
      r.massDryKg != null ? `${r.massDryKg.toFixed(1)} kg dry` : undefined,
  }));
}

export async function getFeedstockById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: feedstocks.id,
      code: feedstocks.code,
      massDryKg: feedstocks.massDryKg,
      feedstockTypeName: feedstockTypes.name,
    })
    .from(feedstocks)
    .leftJoin(feedstockTypes, eq(feedstocks.feedstockTypeId, feedstockTypes.id))
    .where(eq(feedstocks.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.feedstockTypeName ?? result.code,
    subtitle:
      result.massDryKg != null
        ? `${result.massDryKg.toFixed(1)} kg dry`
        : undefined,
  };
}
