/**
 * Feedstock-type options for searchable entity selection.
 */

import { ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getFeedstockTypes(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(feedstockTypes.code, searchPattern),
      ilike(feedstockTypes.name, searchPattern),
      ilike(feedstockTypes.category, searchPattern)
    );
  }

  const results = await db
    .select({
      id: feedstockTypes.id,
      code: feedstockTypes.code,
      name: feedstockTypes.name,
      category: feedstockTypes.category,
    })
    .from(feedstockTypes)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.category,
  }));
}

export async function getFeedstockTypeById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: feedstockTypes.id,
      code: feedstockTypes.code,
      name: feedstockTypes.name,
      category: feedstockTypes.category,
    })
    .from(feedstockTypes)
    .where(eq(feedstockTypes.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.category,
  };
}
