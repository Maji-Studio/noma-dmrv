/**
 * Reactor options for searchable entity selection.
 */

import { ilike, or, eq, and, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { reactors } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getReactors(params: {
  search?: string;
  facilityId?: string;
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, limit } = params;

  const conditions: SQL[] = [isNull(reactors.archivedAt)];

  if (facilityId) {
    conditions.push(eq(reactors.facilityId, facilityId));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(reactors.code, searchPattern),
        ilike(reactors.identifier, searchPattern),
        ilike(reactors.reactorType, searchPattern)
      )!
    );
  }

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      reactorType: reactors.reactorType,
    })
    .from(reactors)
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.identifier,
    subtitle: r.reactorType,
  }));
}

export async function getReactorById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: reactors.id,
      code: reactors.code,
      identifier: reactors.identifier,
      reactorType: reactors.reactorType,
    })
    .from(reactors)
    .where(eq(reactors.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.identifier,
    subtitle: result.reactorType,
  };
}
