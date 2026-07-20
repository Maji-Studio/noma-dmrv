/**
 * Production-run options for searchable entity selection.
 */

import { ilike, eq, and, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, facilities, storageLocations } from "@/db/schema";
import { productionRunDateExpr } from "@/data-access/production-runs/date-expr";
import type { EntityOption } from "@/components/forms/entity-select/types";
import type { OrgContext } from "@/lib/auth/server";
import { formatDate } from "@/lib/format-utils";
import { requireOrgScope } from "../utils";

// Deterministic integer formatting. Bare `Number.prototype.toLocaleString()`
// follows the server's locale (thousands separator), so the label could differ
// between environments — pin the locale.
const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function formatRunDate(date: string | null, fallback: string): string {
  return date ? formatDate(date) : fallback;
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
    conditions.push(ilike(productionRuns.code, searchPattern));
  }

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
      status: productionRuns.status,
      facilityName: facilities.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(
      facilities,
      and(
        eq(productionRuns.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      storageLocations,
      and(
        eq(productionRuns.biocharStorageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(productionRuns.organizationId, ctx.organizationId), whereClause))
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    code: r.code,
    name: formatRunDate(r.date, r.code),
    subtitle: [
      r.facilityName ? `${r.facilityName} · ${r.status}` : r.status,
      r.biocharOutputKg !== null ? `${INTEGER_FORMATTER.format(Math.round(r.biocharOutputKg))} kg biochar` : undefined,
      r.biocharStorageName ? `→ ${r.biocharStorageName}` : undefined,
    ].filter(Boolean).join(" · "),
  }));
}

export async function getProductionRunEntityById(ctx: OrgContext, id: string): Promise<EntityOption | null> {
  requireOrgScope(ctx);
  const [result] = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(),
      status: productionRuns.status,
      facilityName: facilities.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharStorageName: storageLocations.name,
    })
    .from(productionRuns)
    .leftJoin(
      facilities,
      and(
        eq(productionRuns.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
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

  return {
    id: result.id,
    code: result.code,
    name: formatRunDate(result.date, result.code),
    subtitle: [
      result.facilityName ? `${result.facilityName} · ${result.status}` : result.status,
      result.biocharOutputKg !== null ? `${INTEGER_FORMATTER.format(Math.round(result.biocharOutputKg))} kg biochar` : undefined,
      result.biocharStorageName ? `→ ${result.biocharStorageName}` : undefined,
    ].filter(Boolean).join(" · "),
  };
}
