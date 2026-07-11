/**
 * Customer options for searchable entity selection.
 */

import { and, ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getCustomers(ctx: OrgContext, params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(customers.code, searchPattern),
      ilike(customers.name, searchPattern),
      ilike(customers.cropType, searchPattern)
    );
  }

  const results = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      cropType: customers.cropType,
    })
    .from(customers)
    .where(and(eq(customers.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.cropType ?? undefined,
  }));
}

export async function getCustomerById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      cropType: customers.cropType,
    })
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.cropType ?? undefined,
  };
}
