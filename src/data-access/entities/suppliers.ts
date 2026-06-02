/**
 * Supplier options for searchable entity selection.
 */

import { ilike, or, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getSuppliers(params: {
  search?: string;
  limit: number;
}): Promise<EntityOption[]> {
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
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    subtitle: r.location ?? undefined,
  }));
}

export async function getSupplierById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      location: suppliers.location,
    })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.name,
    subtitle: result.location ?? undefined,
  };
}
