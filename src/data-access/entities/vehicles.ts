/**
 * Vehicle options for searchable entity selection.
 */

import { ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getVehicles(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(vehicles.code, searchPattern),
      ilike(vehicles.name, searchPattern),
      ilike(vehicles.vehicleType, searchPattern)
    );
  }

  const results = await db
    .select({
      id: vehicles.id,
      code: vehicles.code,
      name: vehicles.name,
      vehicleType: vehicles.vehicleType,
    })
    .from(vehicles)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.vehicleType,
  }));
}

export async function getVehicleById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: vehicles.id,
      code: vehicles.code,
      name: vehicles.name,
      vehicleType: vehicles.vehicleType,
    })
    .from(vehicles)
    .where(eq(vehicles.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.vehicleType,
  };
}
