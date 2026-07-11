/**
 * Driver options for searchable entity selection.
 */

import { and, ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { drivers } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getDrivers(ctx: OrgContext, params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
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
    .where(and(eq(drivers.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.licenseNumber ?? undefined,
  }));
}

export async function getDriverById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: drivers.id,
      code: drivers.code,
      name: drivers.name,
      licenseNumber: drivers.licenseNumber,
    })
    .from(drivers)
    .where(and(eq(drivers.id, id), eq(drivers.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.licenseNumber ?? undefined,
  };
}
