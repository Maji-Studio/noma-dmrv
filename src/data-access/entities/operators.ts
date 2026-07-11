/**
 * Operator options for searchable entity selection.
 */

import { and, ilike, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { operators } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getOperators(ctx: OrgContext, params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = ilike(operators.name, searchPattern);
  }

  const results = await db
    .select({
      id: operators.id,
      name: operators.name,
      credentials: operators.credentials,
    })
    .from(operators)
    .where(and(eq(operators.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.name,
    name: r.name,
    subtitle: r.credentials ?? undefined,
  }));
}

export async function getOperatorById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: operators.id,
      name: operators.name,
      credentials: operators.credentials,
    })
    .from(operators)
    .where(and(eq(operators.id, id), eq(operators.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.name,
    name: result.name,
    subtitle: result.credentials ?? undefined,
  };
}
