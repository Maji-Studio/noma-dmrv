/**
 * Vehicles Data Access Layer: list, read, edit and delete.
 *
 * Creation stays in `quick-add.ts`. A vehicle's type selects the Isometric
 * emission factor (Transportation v1.1 Eq. 3). Each feedstock intake's derived
 * transport leg copies the type and model year when it is synced, so an edit
 * to either refreshes those snapshots in the same transaction. A type change
 * is refused while a submitted credit batch holds any record that uses the
 * vehicle (decision 2026-10-13, issue #945).
 */

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { isPgForeignKeyViolation, isPgUniqueViolation } from "@/db/errors";
import {
  creditBatches,
  deliveries,
  feedstocks,
  transportLegs,
  vehicles,
  type Vehicle,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import {
  formatFleetDeleteBlocker,
  formatVehicleTypeLockMessage,
} from "@/lib/fleet/messages";
import {
  getCertifiedLineage,
  getLockedCertifiedLineageForTargetSet,
  isSubmittedLineageRow,
} from "./certification-lineage-guards";
import { countVehicleUsage } from "./fleet-usage";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const VEHICLE_CONFLICT_ENTITY = "vehicle";
const VEHICLE_NAME_CONSTRAINT = "vehicles_organization_id_name_unique";
const VEHICLE_NAME_TAKEN = "A vehicle with this name already exists";
const VEHICLE_NOT_FOUND = "Vehicle not found";
const VEHICLE_FK_CONSTRAINTS = [
  "deliveries_vehicle_id_vehicles_id_fk",
  "feedstock_deliveries_vehicle_id_vehicles_id_fk",
  "feedstocks_vehicle_id_vehicles_id_fk",
] as const;
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

/**
 * Lock every feedstock intake that uses the vehicle, in id order. A feedstock
 * save locks its own row before it resyncs its leg, so holding these rows means
 * no concurrent save can write the old type back after this edit commits.
 */
async function lockFeedstocksUsingVehicle(
  ctx: OrgContext,
  tx: DbTransaction,
  vehicleId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: feedstocks.id })
    .from(feedstocks)
    .where(and(eq(feedstocks.vehicleId, vehicleId), eq(feedstocks.organizationId, ctx.organizationId)))
    .orderBy(asc(feedstocks.id))
    .for("update");
  return rows.map((row) => row.id);
}

async function deliveriesUsingVehicle(
  ctx: OrgContext,
  tx: DbTransaction,
  vehicleId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.vehicleId, vehicleId), eq(deliveries.organizationId, ctx.organizationId)));
  return rows.map((row) => row.id);
}

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

/** Feedstocks whose own lineage has no submitted credit batch. */
async function unsubmittedFeedstocks(
  ctx: OrgContext,
  tx: DbTransaction,
  feedstockIds: readonly string[],
): Promise<string[]> {
  const unsubmitted: string[] = [];
  for (const feedstockId of feedstockIds) {
    // The artifact locks are already held by the set-wide lineage lock.
    const lineage = await getCertifiedLineage(ctx, tx, { entityType: "feedstock", entityId: feedstockId });
    if (!lineage.some(isSubmittedLineageRow)) unsubmitted.push(feedstockId);
  }
  return unsubmitted;
}

async function throwVehicleTypeLocked(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchIds: readonly string[],
): Promise<never> {
  const batches = await tx
    .select({ id: creditBatches.id, code: creditBatches.code })
    .from(creditBatches)
    .where(and(inArray(creditBatches.id, [...creditBatchIds]), eq(creditBatches.organizationId, ctx.organizationId)))
    .orderBy(asc(creditBatches.code));
  const [first] = batches;
  throw new DomainError(
    "certification_locked",
    formatVehicleTypeLockMessage(batches.map((batch) => batch.code)),
    first ? { conflict: { entity: "creditBatch", id: first.id, code: conflictCode(first.code) } } : {},
  );
}

/**
 * Resolve which feedstock legs take the new type and model year. Throws when
 * the type changes while a submitted credit batch holds a record using it.
 */
async function legsToRefresh(
  ctx: OrgContext,
  tx: DbTransaction,
  vehicleId: string,
  typeChanged: boolean,
): Promise<string[]> {
  // Re-read under the vehicle lock: a record that pointed here while we waited
  // has committed by now, and a new one cannot appear until we commit.
  const feedstockIds = await lockFeedstocksUsingVehicle(ctx, tx, vehicleId);
  const deliveryIds = await deliveriesUsingVehicle(ctx, tx, vehicleId);
  const lineage = await getLockedCertifiedLineageForTargetSet(ctx, tx, { feedstockIds, deliveryIds });
  const submitted = lineage.filter(isSubmittedLineageRow);

  if (submitted.length === 0) return feedstockIds;
  if (typeChanged) {
    await throwVehicleTypeLocked(ctx, tx, submitted.map((row) => row.creditBatchId));
  }
  // A model year edit is metadata: it saves, and only legs outside a
  // submitted credit batch follow it.
  return unsubmittedFeedstocks(ctx, tx, feedstockIds);
}

export async function updateVehicle(
  ctx: OrgContext,
  vehicleId: string,
  data: UpdateVehicleData,
  expectedVersion: number,
): Promise<Vehicle> {
  requireOrgScope(ctx);
  const modelYear = data.modelYear ?? null;

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ vehicleType: vehicles.vehicleType, modelYear: vehicles.modelYear })
        .from(vehicles)
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, ctx.organizationId)));
      if (!current) throw new DomainError("not_found", VEHICLE_NOT_FOUND);
      const snapshotChanges =
        current.vehicleType !== data.vehicleType || current.modelYear !== modelYear;

      // Feedstock rows before the vehicle row: the order a feedstock save takes.
      if (snapshotChanges) await lockFeedstocksUsingVehicle(ctx, tx, vehicleId);
      const locked = await lockedVehicle(ctx, tx, vehicleId, expectedVersion);
      const typeChanged = locked.vehicleType !== data.vehicleType;
      const refreshLegs = typeChanged || locked.modelYear !== modelYear
        ? await legsToRefresh(ctx, tx, vehicleId, typeChanged)
        : [];

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
        await tx
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
          ));
      }

      return updated;
    });
  } catch (error) {
    if (isPgUniqueViolation(error, VEHICLE_NAME_CONSTRAINT)) {
      throw new DomainError("conflict", VEHICLE_NAME_TAKEN);
    }
    throw error;
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
