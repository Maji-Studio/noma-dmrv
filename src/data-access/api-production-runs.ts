import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, productionRunFeedstockDraws } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { findApiReactor } from "./api-reactors";
import { requireApiLookupFacility, lookupCursorCreatedAt, lookupPosition, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiProductionRunFilters { facilityId?: string; reactorId?: string; status?: ProductionRunStatus; code?: string }
function runFields(ctx: OrgContext) {
  requireOrgScope(ctx);
  return {
    id: productionRuns.id,
    code: productionRuns.code,
    version: productionRuns.version,
    facilityId: productionRuns.facilityId,
    reactorId: productionRuns.reactorId,
    status: productionRuns.status,
    cancellationReason: productionRuns.cancellationReason,
    startTime: productionRuns.startTime,
    endTime: productionRuns.endTime,
    operatorId: productionRuns.operatorId,
    feedstockMoisturePercent: productionRuns.feedstockMoisturePercent,
    feedingRateKgHr: productionRuns.feedingRateKgHr,
    residenceTimeMinutes: productionRuns.residenceTimeMinutes,
    dieselOperationLiters: productionRuns.dieselOperationLiters,
    dieselGensetLiters: productionRuns.dieselGensetLiters,
    preprocessingFuelLiters: productionRuns.preprocessingFuelLiters,
    electricityKwh: productionRuns.electricityKwh,
    biocharOutputKg: productionRuns.biocharOutputKg,
    biocharMoisturePercent: productionRuns.biocharMoisturePercent,
    biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    createdAt: productionRuns.createdAt,
    updatedAt: productionRuns.updatedAt,
    // Keep the row and its draws in the same statement snapshot, including on tx.
    // Raw subquery columns stay qualified so the correlation cannot bind locally.
    feedstockDraws: sql<{ storageLocationId: string; wetMassKg: number }[]>`(
      select coalesce(json_agg(json_build_object(
        'storageLocationId', draw.storage_location_id,
        'wetMassKg', draw.wet_mass_kg
      ) order by draw.id), '[]'::json)
      from ${productionRunFeedstockDraws} as draw
      where draw.organization_id = ${ctx.organizationId}
        and draw.production_run_id = "production_runs"."id"
        and draw.organization_id = "production_runs"."organization_id"
    )`,
    cursorCreatedAt: lookupCursorCreatedAt(productionRuns.createdAt),
  };
}

function runQuery(ctx: OrgContext, executor: Executor) {
  requireOrgScope(ctx);
  return executor.select(runFields(ctx)).from(productionRuns);
}

export async function findApiProductionRun(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const rows = await runQuery(ctx, executor).where(and(eq(productionRuns.organizationId, ctx.organizationId),
    "id" in identifier ? eq(productionRuns.id, identifier.id) : eq(productionRuns.code, identifier.code))).limit(1);
  if (!rows.length) throw new DomainError("not_found", "Production run was not found.", {
    issues: [{ path: ["productionRunId"], code: "not_found", message: "Production run was not found." }],
  });
  return rows[0];
}

export async function listApiProductionRuns(ctx: OrgContext, filters: ApiProductionRunFilters, limit: number, cursor?: ApiLookupPosition) {
  requireOrgScope(ctx);
  await requireApiLookupFacility(ctx, filters.facilityId);
  if (filters.reactorId) await findApiReactor(ctx, { id: filters.reactorId });
  const rows = await runQuery(ctx, db).where(and(
    eq(productionRuns.organizationId, ctx.organizationId), isNull(productionRuns.archivedAt),
    filters.facilityId ? eq(productionRuns.facilityId, filters.facilityId) : undefined,
    filters.reactorId ? eq(productionRuns.reactorId, filters.reactorId) : undefined,
    filters.status ? eq(productionRuns.status, filters.status) : undefined,
    filters.code !== undefined ? eq(productionRuns.code, filters.code) : undefined,
    lookupPosition(productionRuns, cursor),
  )).orderBy(desc(productionRuns.createdAt), desc(productionRuns.id)).limit(limit + 1);
  return rows;
}
