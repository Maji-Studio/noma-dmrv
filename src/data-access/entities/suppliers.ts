/**
 * Supplier options for searchable entity selection.
 */

import { and, ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getSuppliers(ctx: OrgContext, params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(suppliers.code, searchPattern),
      ilike(suppliers.name, searchPattern),
      ilike(suppliers.location, searchPattern)
    );
  }

  const results = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      location: suppliers.location,
    })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.location ?? undefined,
  }));
}

export async function getSupplierById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      location: suppliers.location,
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.location ?? undefined,
  };
}
