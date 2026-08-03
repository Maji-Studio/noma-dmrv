/**
 * Vehicle options for searchable entity selection.
 */

import { and, ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { vehicles } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { formatVehicleType } from "@/schemas/vehicles";
import { requireOrgScope } from "../utils";

export async function getVehicles(ctx: OrgContext, params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
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
    .where(and(eq(vehicles.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: formatVehicleType(r.vehicleType),
  }));
}

export async function getVehicleById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: vehicles.id,
      code: vehicles.code,
      name: vehicles.name,
      vehicleType: vehicles.vehicleType,
    })
    .from(vehicles)
    .where(and(eq(vehicles.id, id), eq(vehicles.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: formatVehicleType(result.vehicleType),
  };
}
