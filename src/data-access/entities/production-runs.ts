/**
 * Production-run options for searchable entity selection.
 */

import { ilike, eq, and, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, facilities, storageLocations } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";

export async function getProductionRunsEntity(params: {
  search?: string;
  facilityId?: string;
  status?: (typeof productionRuns.status.enumValues)[number];
  limit: number;
}): Promise<EntityOption[]> {
  const { search, facilityId, status, limit } = params;

  const conditions: SQL[] = [];

  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  if (status) {
    conditions.push(eq(productionRuns.status, status));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(ilike(productionRuns.code, searchPattern));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
      status: productionRuns.status,
      facilityName: facilities.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .leftJoin(storageLocations, eq(productionRuns.biocharStorageLocationId, storageLocations.id))
    .where(whereClause)
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.date ? new Date(r.date).toLocaleDateString() : r.code,
    subtitle: [
      r.facilityName ? `${r.facilityName} · ${r.status}` : r.status,
      r.biocharOutputKg !== null ? `${Math.round(r.biocharOutputKg).toLocaleString()} kg biochar` : undefined,
      r.biocharStorageName ? `→ ${r.biocharStorageName}` : undefined,
    ].filter(Boolean).join(" · "),
  }));
}

export async function getProductionRunEntityById(id: string): Promise<EntityOption | null> {
  const [result] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
      status: productionRuns.status,
      facilityName: facilities.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(facilities, eq(productionRuns.facilityId, facilities.id))
    .leftJoin(storageLocations, eq(productionRuns.biocharStorageLocationId, storageLocations.id))
    .where(eq(productionRuns.id, id))
    .limit(1);

  if (!result) return null;

  return {
    id: result.id,
    code: result.code,
    name: result.date ? new Date(result.date).toLocaleDateString() : result.code,
    subtitle: [
      result.facilityName ? `${result.facilityName} · ${result.status}` : result.status,
      result.biocharOutputKg !== null ? `${Math.round(result.biocharOutputKg).toLocaleString()} kg biochar` : undefined,
      result.biocharStorageName ? `→ ${result.biocharStorageName}` : undefined,
    ].filter(Boolean).join(" · "),
  };
}
