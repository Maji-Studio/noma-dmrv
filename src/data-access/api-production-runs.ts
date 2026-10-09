import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, productionRunFeedstockDraws, facilities, reactors, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { findApiReactor } from "./api-reactors";
import { requireApiLookupFacility, lookupCursorCreatedAt, lookupPosition, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiProductionRunFilters { facilityId?: string; reactorId?: string; status?: ProductionRunStatus; code?: string }
const runFields = {
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
  facilityCode: facilities.code, timeZone: facilities.timezone,
  reactorCode: reactors.code, biocharStorageLocationCode: storageLocations.code,
  cursorCreatedAt: lookupCursorCreatedAt(productionRuns.createdAt),
};

function runQuery(ctx: OrgContext, executor: Executor) {
  requireOrgScope(ctx);
  return executor.select(runFields).from(productionRuns)
    .innerJoin(facilities, and(eq(facilities.id, productionRuns.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .innerJoin(reactors, and(eq(reactors.id, productionRuns.reactorId), eq(reactors.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(storageLocations.id, productionRuns.biocharStorageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));
}
type RunRow = Awaited<ReturnType<typeof runQuery>>[number];

async function withDraws(ctx: OrgContext, executor: Executor, rows: RunRow[]) {
  requireOrgScope(ctx);
  const draws = rows.length ? await executor.select({
    productionRunId: productionRunFeedstockDraws.productionRunId,
    storageLocationId: productionRunFeedstockDraws.storageLocationId,
    storageLocationCode: storageLocations.code, wetMassKg: productionRunFeedstockDraws.wetMassKg,
  }).from(productionRunFeedstockDraws)
    .innerJoin(storageLocations, and(eq(storageLocations.id, productionRunFeedstockDraws.storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), inArray(productionRunFeedstockDraws.productionRunId, rows.map((row) => row.id))))
    .orderBy(asc(productionRunFeedstockDraws.id)) : [];
  return rows.map((row) => ({ ...row, feedstockDraws: draws.filter((draw) => draw.productionRunId === row.id)
    .map(({ storageLocationId, storageLocationCode, wetMassKg }) => ({ storageLocationId, storageLocationCode, wetMassKg })) }));
}

export async function findApiProductionRun(ctx: OrgContext, identifier: ApiLookupIdentifier, executor: Executor = db) {
  requireOrgScope(ctx);
  const rows = await runQuery(ctx, executor).where(and(eq(productionRuns.organizationId, ctx.organizationId),
    "id" in identifier ? eq(productionRuns.id, identifier.id) : eq(productionRuns.code, identifier.code))).limit(1);
  if (!rows.length) throw new DomainError("not_found", "Production run was not found.", {
    issues: [{ path: ["productionRunId"], code: "not_found", message: "Production run was not found." }],
  });
  return (await withDraws(ctx, executor, rows))[0];
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
  return withDraws(ctx, db, rows);
}
