/**
 * Vehicles Data Access Layer: list, read, edit and delete.
 *
 * Creation stays in `quick-add.ts`. Feedstock legs copy vehicle type and model
 * year as Transportation module records. Editing either refreshes unsubmitted
 * legs in the same transaction; submitted legs retain their evidence snapshot.
 */

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { isPgForeignKeyViolation, isPgUniqueViolation } from "@/db/errors";
import {
  creditBatchProductionRuns,
  feedstocks,
  productionRunFeedstocks,
  transportLegs,
  vehicles,
  type Vehicle,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { formatFleetDeleteBlocker } from "@/lib/fleet/messages";
import {
  getLockedCertifiedLineageForTargetSet,
  isSubmittedLineageRow,
  type LockedCertifiedLineageRow,
} from "./certification-lineage-guards";
import { countVehicleUsage } from "./fleet-usage";
import { assertRowVersion, nextVersion } from "./row-version";
import { recordScopedActivityChange, resolveWriteActivityScopes } from "./write-activity";
import { requireOrgScope } from "./utils";

const VEHICLE_CONFLICT_ENTITY = "vehicle";
const VEHICLE_NAME_CONSTRAINT = "vehicles_organization_id_name_unique";
const VEHICLE_NAME_TAKEN = "A vehicle with this name already exists";
const VEHICLE_NOT_FOUND = "Vehicle not found";
const VEHICLE_FK_CONSTRAINTS = [
  "deliveries_vehicle_id_vehicles_id_fk",
  "feedstocks_vehicle_id_vehicles_id_fk",
] as const;
/** Restarts when records move onto or off the vehicle mid-edit. */
const MAX_UPDATE_ATTEMPTS = 3;
const VEHICLE_REFERENCES_CHANGED =
  "The vehicle was not saved because records using it changed while it was saving. Save again.";
const VEHICLE_IN_USE =
  "Vehicle was not deleted because records still use it. Choose another vehicle on those records, or keep this one.";

export interface UpdateVehicleData {
  name: string;
  vehicleType: string;
  identifier?: string | null;
  fuelType?: string | null;
  fuelConsumptionLPerKm?: number | null;
  modelYear?: number | null;
}

// ============================================
// Reads
// ============================================

export async function listVehicles(ctx: OrgContext): Promise<Vehicle[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(vehicles)
    .where(eq(vehicles.organizationId, ctx.organizationId))
    .orderBy(asc(vehicles.name), asc(vehicles.id));
}

export async function getVehicle(ctx: OrgContext, vehicleId: string): Promise<Vehicle | null> {
  requireOrgScope(ctx);
  const [vehicle] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, ctx.organizationId)));
  return vehicle ?? null;
}

// ============================================
// Update
// ============================================

interface VehicleReferences {
  feedstockIds: string[];
}

/**
 * The intakes that use the vehicle. With `lockFeedstocks`, the
 * intake rows are locked in id order: a feedstock save locks its own row
 * before it resyncs its leg, so holding them means no concurrent save can
 * write the old type back after this edit commits.
 */
async function vehicleReferences(
  ctx: OrgContext,
  tx: DbTransaction,
  vehicleId: string,
  lockFeedstocks: boolean,
): Promise<VehicleReferences> {
  const feedstockQuery = tx
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(and(eq(feedstocks.vehicleId, vehicleId), eq(feedstocks.organizationId, ctx.organizationId)))
    .orderBy(asc(feedstocks.id));
  // NO KEY UPDATE still excludes a concurrent save or delete of these rows,
  // but not the KEY SHARE a foreign-key insert takes (a production run adding
  // a feedstock draw while it holds the lineage's certification locks).
  const feedstockRows = await (lockFeedstocks ? feedstockQuery.for("no key update") : feedstockQuery);
  return {
    feedstockIds: feedstockRows.map((row) => row.id),
  };
}

function sameReferences(a: VehicleReferences, b: VehicleReferences): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((id, index) => id === y[index]);
  return same(a.feedstockIds, b.feedstockIds);
}

/**
 * The records using the vehicle changed between the unlocked read and the
 * vehicle row lock. Taking the new records' certification locks after the
 * vehicle lock would invert the lock order, so the whole transaction restarts.
 */
class VehicleReferencesChangedError extends Error {}

async function lockedVehicle(
  ctx: OrgContext,
  tx: DbTransaction,
  vehicleId: string,
  expectedVersion: number,
): Promise<Vehicle> {
  // FOR UPDATE conflicts with the KEY SHARE lock a foreign-key check takes, so
  // no record can newly reference this vehicle until this transaction ends.
  const [locked] = await tx
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, ctx.organizationId)))
    .for("update");
  if (!locked) throw new DomainError("not_found", VEHICLE_NOT_FOUND);
  assertRowVersion({
    entity: VEHICLE_CONFLICT_ENTITY,
    id: vehicleId,
    expectedVersion,
    actualVersion: locked.version,
  });
  return locked;
}

/**
 * Feedstocks in `feedstockIds` that no submitted credit batch holds. A
 * feedstock belongs to a batch through the batch's production runs, the same
 * path its certified lineage takes, so the submitted batches from the locked
 * set-wide lineage decide it without another lineage read.
 */
async function unsubmittedFeedstocks(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockIds: readonly string[],
  submittedBatchIds: readonly string[],
): Promise<string[]> {
  const held = await tx
    .selectDistinct({ feedstockId: productionRunFeedstocks.feedstockId })
    .from(productionRunFeedstocks)
    .innerJoin(
      creditBatchProductionRuns,
      and(
        eq(creditBatchProductionRuns.productionRunId, productionRunFeedstocks.productionRunId),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ),
    )
    .where(and(
      inArray(productionRunFeedstocks.feedstockId, [...feedstockIds]),
      inArray(creditBatchProductionRuns.creditBatchId, [...submittedBatchIds]),
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
    ));
  const submitted = new Set(held.map((row) => row.feedstockId));
  return feedstockIds.filter((id) => !submitted.has(id));
}

/**
 * One attempt at the edit. Lock order, shared with every feedstock and
 * delivery save: record rows, then certification artifact locks, then the
 * vehicle row (a save takes KEY SHARE on it only when it points a record at
 * the vehicle, after its own artifact locks). Because this edit takes the
 * artifact locks before the vehicle row, neither side ever waits for an
 * artifact while holding a lock the other needs, so the two cannot deadlock.
 */
async function updateVehicleOnce(
  ctx: OrgContext,
  tx: DbTransaction,
  vehicleId: string,
  data: UpdateVehicleData,
  expectedVersion: number,
): Promise<Vehicle> {
  const modelYear = data.modelYear ?? null;
  const [current] = await tx
    .select({ vehicleType: vehicles.vehicleType, modelYear: vehicles.modelYear })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, ctx.organizationId)));
  if (!current) throw new DomainError("not_found", VEHICLE_NOT_FOUND);
  const typeChanged = current.vehicleType !== data.vehicleType;
  const snapshotChanged = typeChanged || current.modelYear !== modelYear;

  let references: VehicleReferences | null = null;
  let submitted: LockedCertifiedLineageRow[] = [];
  if (snapshotChanged) {
    references = await vehicleReferences(ctx, tx, vehicleId, true);
    const lineage = await getLockedCertifiedLineageForTargetSet(ctx, tx, { ...references, deliveryIds: [] });
    submitted = lineage.filter(isSubmittedLineageRow);
  }

  const locked = await lockedVehicle(ctx, tx, vehicleId, expectedVersion);
  if (locked.vehicleType !== current.vehicleType || locked.modelYear !== current.modelYear) {
    throw new VehicleReferencesChangedError();
  }
  // Under the vehicle lock no record can newly point here, and one that did
  // while we waited has committed. Any difference means locks we lack.
  if (references && !sameReferences(references, await vehicleReferences(ctx, tx, vehicleId, false))) {
    throw new VehicleReferencesChangedError();
  }

  // Type and model year edits refresh only legs outside submitted credit batches.
  const refreshLegs = !references
    ? []
    : submitted.length === 0
      ? references.feedstockIds
      : await unsubmittedFeedstocks(
        ctx,
        tx,
        references.feedstockIds,
        submitted.map((row) => row.creditBatchId),
      );

  const [duplicate] = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(
      eq(vehicles.name, data.name),
      ne(vehicles.id, vehicleId),
      eq(vehicles.organizationId, ctx.organizationId),
    ));
  if (duplicate) throw new DomainError("conflict", VEHICLE_NAME_TAKEN);

  const [updated] = await tx
    .update(vehicles)
    .set({
      name: data.name,
      identifier: data.identifier ?? null,
      vehicleType: data.vehicleType,
      fuelType: data.fuelType ?? null,
      fuelConsumptionLPerKm: data.fuelConsumptionLPerKm ?? null,
      modelYear,
      version: nextVersion(vehicles.version),
      updatedAt: new Date(),
    })
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, ctx.organizationId)))
    .returning();

  if (refreshLegs.length > 0) {
    // Lock order: lineage and vehicle locks, then derived transport legs.
    const previousLegs = await tx.select().from(transportLegs).where(and(
      eq(transportLegs.entityType, "feedstock"), eq(transportLegs.isDerived, true),
      inArray(transportLegs.entityId, refreshLegs), eq(transportLegs.organizationId, ctx.organizationId),
    )).orderBy(transportLegs.id).for("update");
    const refreshed = await tx
      .update(transportLegs)
      .set({
        vehicleType: data.vehicleType,
        modelYear,
        version: nextVersion(transportLegs.version),
        updatedAt: new Date(),
      })
      .where(and(
        eq(transportLegs.entityType, "feedstock"),
        eq(transportLegs.isDerived, true),
        inArray(transportLegs.entityId, refreshLegs),
        eq(transportLegs.organizationId, ctx.organizationId),
      ))
      .returning();
    for (const leg of refreshed) await recordScopedActivityChange(ctx, tx, {
      entityType: "transport_leg", entityId: leg.id, action: "updated", source: "system", actorUserId: ctx.userId,
    }, await resolveWriteActivityScopes(ctx, tx, leg.entityType, leg.entityId), previousLegs.find(row => row.id === leg.id)!, leg, { skipEmpty: true });
  }

  return updated;
}

export async function updateVehicle(
  ctx: OrgContext,
  vehicleId: string,
  data: UpdateVehicleData,
  expectedVersion: number,
): Promise<Vehicle> {
  requireOrgScope(ctx);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction((tx) => updateVehicleOnce(ctx, tx, vehicleId, data, expectedVersion));
    } catch (error) {
      if (error instanceof VehicleReferencesChangedError) {
        if (attempt < MAX_UPDATE_ATTEMPTS) continue;
        throw new DomainError("concurrent_write_retry", VEHICLE_REFERENCES_CHANGED, { retryable: true });
      }
      if (isPgUniqueViolation(error, VEHICLE_NAME_CONSTRAINT)) {
        throw new DomainError("conflict", VEHICLE_NAME_TAKEN);
      }
      throw error;
    }
  }
}

// ============================================
// Delete
// ============================================

export async function deleteVehicle(
  ctx: OrgContext,
  vehicleId: string,
  expectedVersion: number,
): Promise<void> {
  requireOrgScope(ctx);
  try {
    await db.transaction(async (tx) => {
      const locked = await lockedVehicle(ctx, tx, vehicleId, expectedVersion);
      const blocker = formatFleetDeleteBlocker(
        "vehicle",
        locked.code,
        await countVehicleUsage(ctx, tx, vehicleId),
      );
      if (blocker) throw new DomainError("conflict", blocker);

      await tx
        .delete(vehicles)
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, ctx.organizationId)));
    });
  } catch (error) {
    if (VEHICLE_FK_CONSTRAINTS.some((constraint) => isPgForeignKeyViolation(error, constraint))) {
      throw new DomainError("conflict", VEHICLE_IN_USE);
    }
    throw error;
  }
}
