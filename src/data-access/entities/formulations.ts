/**
 * Formulation options for searchable entity selection.
 */

import { ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { formulations } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getFormulationsEntity(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
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
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.biocharRatio !== null ? `${Math.round(r.biocharRatio * 100)}% biochar` : undefined,
  }));
}

export async function getFormulationEntityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: formulations.id,
      code: formulations.code,
      name: formulations.name,
      biocharRatio: formulations.biocharRatio,
    })
    .from(formulations)
    .where(eq(formulations.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.biocharRatio !== null ? `${Math.round(result.biocharRatio * 100)}% biochar` : undefined,
  };
}
