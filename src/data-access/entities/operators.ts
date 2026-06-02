/**
 * Operator options for searchable entity selection.
 */

import { ilike, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { operators } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getOperators(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
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
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.name,
    name: r.name,
    subtitle: r.credentials ?? undefined,
  }));
}

export async function getOperatorById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: operators.id,
      name: operators.name,
      credentials: operators.credentials,
    })
    .from(operators)
    .where(eq(operators.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.name,
    name: result.name,
    subtitle: result.credentials ?? undefined,
  };
}
