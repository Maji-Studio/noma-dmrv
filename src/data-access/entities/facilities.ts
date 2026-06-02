/**
 * Facility options for searchable entity selection.
 */

import { ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getFacilities(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(facilities.code, searchPattern),
      ilike(facilities.name, searchPattern),
      ilike(facilities.location, searchPattern)
    );
  }

  const results = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      location: facilities.location,
    })
    .from(facilities)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.location ?? undefined,
  }));
}

export async function getFacilityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      location: facilities.location,
    })
    .from(facilities)
    .where(eq(facilities.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.location ?? undefined,
  };
}
