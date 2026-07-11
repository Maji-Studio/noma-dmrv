/**
 * Formulation options for searchable entity selection.
 */

import { and, ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { formulations } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "../utils";

export async function getFormulationsEntity(ctx: OrgContext, params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, limit } = params;

  let whereClause: SQL | undefined;
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause = or(
      ilike(formulations.code, searchPattern),
      ilike(formulations.name, searchPattern),
      ilike(formulations.description, searchPattern)
    );
  }

  const results = await db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
      biocharRatio: formulations.biocharRatio,
    })
    .from(formulations)
    .where(and(eq(formulations.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.biocharRatio !== null ? `${Math.round(r.biocharRatio * 100)}% biochar` : undefined,
  }));
}

export async function getFormulationEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
      biocharRatio: formulations.biocharRatio,
    })
    .from(formulations)
    .where(and(eq(formulations.id, id), eq(formulations.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.biocharRatio !== null ? `${Math.round(result.biocharRatio * 100)}% biochar` : undefined,
  };
}
