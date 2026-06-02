/**
 * Driver options for searchable entity selection.
 */

import { ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { drivers } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getDrivers(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(drivers.code, searchPattern),
      ilike(drivers.name, searchPattern)
    );
  }

  const results = await db
    .select({
      id: drivers.id,
      code: drivers.code,
      name: drivers.name,
      licenseNumber: drivers.licenseNumber,
    })
    .from(drivers)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.licenseNumber ?? undefined,
  }));
}

export async function getDriverById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: drivers.id,
      code: drivers.code,
      name: drivers.name,
      licenseNumber: drivers.licenseNumber,
    })
    .from(drivers)
    .where(eq(drivers.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.licenseNumber ?? undefined,
  };
}
