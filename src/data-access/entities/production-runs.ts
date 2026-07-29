/**
 * Production-run options for searchable entity selection.
 */

import {
  ilike,
  eq,
  and,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, storageLocations } from "@/db/schema";
import { productionRunDateExpr } from "@/data-access/production-runs/date-expr";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { formatDate } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { formatProductionRunStatus } from "@/schemas/production-runs";
import { requireOrgScope } from "../utils";

interface ProductionRunOptionRow {
  id: string;
  code: string;
  date: string | null;
  status: (typeof productionRuns.status.enumValues)[number];
  biocharOutputKg: number | null;
  biocharDryMassKg: number | null;
  biocharStorageName: string | null;
}

export function toProductionRunEntityOption(
  row: ProductionRunOptionRow,
): EntityOption {
  return {
    id: row.id,
    code: row.code,
    name: formatDate(row.date),
    subtitle: [
      formatProductionRunStatus(row.status),
      row.biocharStorageName ?? undefined,
      formatWetDryMass({
        wetKg: row.biocharOutputKg,
        dryKg: row.biocharDryMassKg,
      }),
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export async function getProductionRunsEntity(ctx: OrgContext, params: {
  search?: string;
  facilityId?: string;
  status?: (typeof productionRuns.status.enumValues)[number];
  limit: number;
}): Promise<EntityOption[]> {
  requireOrgScope(ctx);
  const { search, facilityId, status, limit } = params;

  const conditions: SQL[] = [isNull(productionRuns.archivedAt)];

  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  if (status) {
    conditions.push(eq(productionRuns.status, status));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(productionRuns.code, searchPattern),
        ilike(storageLocations.name, searchPattern),
        sql`${productionRunDateExpr()}::text ILIKE ${searchPattern}`,
      )!,
    );
  }

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
      status: productionRuns.status,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(
      storageLocations,
      and(
        eq(productionRuns.biocharStorageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(productionRuns.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map(toProductionRunEntityOption);
}

export async function getProductionRunEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
      status: productionRuns.status,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(
      storageLocations,
      and(
        eq(productionRuns.biocharStorageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(productionRuns.id, id), eq(productionRuns.organizationId, ctx.organizationId)))
    .limit(1);

  if (!result) return null;

  return toProductionRunEntityOption(result);
}
