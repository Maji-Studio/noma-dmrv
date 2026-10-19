import { and, count, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { suppliers, supplierLocations, type SupplierLocation } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CaptureActivity } from "@/lib/activity-changes";
import { locationDistanceFillWarnings, supplierLocationDefaultMovedWarning } from "@/lib/location-write-warnings";
import { partyNotFound, partyLocationNotFound, partyArchived, partyArchivedForEdit } from "@/lib/party-domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { addSupplierLocationInput, updateSupplierLocationInput, supplierLocationVersionInput, type AddSupplierLocationInput, type UpdateSupplierLocationInput, type SupplierLocationVersionInput } from "@/schemas/supplier-location-input";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";
import { fillMissingLocationDistances, type LocationDistanceFillResult } from "./location-distance-fill";
import { lockLocationFacilities } from "./party-reference-guards";
import { upsertLocationFacilityDistances, withLocationFacilityDistances } from "./location-facility-distances";
import { assertRowVersion, nextVersion } from "./row-version";
import { SUPPLIER_LOCATION_ORDER } from "./supplier-detail";
import { requireOrgScope } from "./utils";
import { demoteDefaultPartyLocation } from "./party-location-default";

const SUPPLIER_LOCATION_CONFLICT_ENTITY = "supplierLocation";

export type SupplierLocationWriteOutput = SupplierLocation & { warnings: string[] };

export interface SupplierLocationInsertInput {
  name?: string | null;
  country: string;
  stateRegion?: string | null;
  city?: string | null;
  gpsLatitude: number;
  gpsLongitude: number;
  address?: string | null;
  facilityDistances?: FacilityDistanceInput[];
  isDefault?: boolean;
}

/**
 * Insert one supplier location inside an open transaction, keeping the
 * at-most-one-default invariant the partial unique index enforces. The supplier
 * is re-checked through `tx` so a supplier inserted earlier in the same
 * transaction is visible.
 */
export async function createSupplierLocationInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  supplierId: string,
  data: SupplierLocationInsertInput,
  captureLocation?: CaptureActivity,
): Promise<{ location: SupplierLocation; fill: LocationDistanceFillResult }> {
  requireOrgScope(ctx);

  await lockLocationFacilities(ctx, tx, data.facilityDistances, []);
  const [supplier] = await tx
    .select({ id: suppliers.id, code: suppliers.code, archivedAt: suppliers.archivedAt })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organizationId, ctx.organizationId),
      ),
    )
    // Match deletion and location updates: parent before children.
    .for(data.facilityDistances?.length ? "update" : "no key update");

  if (!supplier) {
    throw partyNotFound("supplier");
  }

  if (supplier.archivedAt) throw partyArchived("supplier", supplier.code);

  // The supplier's first location is always its default.
  const [{ value: defaultCount }] = await tx
    .select({ value: count() })
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.organizationId, ctx.organizationId),
        eq(supplierLocations.isDefault, true),
      ),
    );
  const makeDefault = data.isDefault === true || defaultCount === 0;

  // Clear the prior default first so the partial unique index never sees two.
  if (makeDefault) {
    await demoteDefaultPartyLocation(ctx, tx, { kind: "supplier", parentId: supplierId, captureLocation });
  }

  const [location] = await tx
    .insert(supplierLocations)
    .values({
      organizationId: ctx.organizationId,
      supplierId,
      name: data.name ?? null,
      country: data.country,
      stateRegion: data.stateRegion ?? null,
      city: data.city ?? null,
      gpsLatitude: data.gpsLatitude,
      gpsLongitude: data.gpsLongitude,
      address: data.address ?? null,
      isDefault: makeDefault,
    })
    .returning();

  const fill = await upsertLocationFacilityDistances(ctx, tx, "supplier", location.id, data.facilityDistances);
  return { location: (await withLocationFacilityDistances(ctx, "supplier", [location], tx))[0], fill };
}


/**
 * Supplier add lock order: non-null facilities FOR SHARE sorted; supplier FOR
 * UPDATE when pairs are supplied, otherwise FOR NO KEY UPDATE; demote default
 * with a version bump; insert; pairs; fill (feedstocks FOR UPDATE by id, lineage
 * artifacts, skip submitted, leg FOR UPDATE, syncFeedstockTransportLeg); tx
 * readback. The operation drains storage after commit. Parent version is unchanged.
 */
export async function addSupplierLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: AddSupplierLocationInput, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<SupplierLocationWriteOutput> {
  requireOrgScope(ctx);
  const parsed = addSupplierLocationInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { supplierId, ...data } = parsed.data;
  const { location: saved, fill } = await createSupplierLocationInTransaction(ctx, tx, supplierId, data, captureLocation);
  capture?.(saved.id, null, saved);
  return { ...saved, warnings: locationDistanceFillWarnings("supplier", fill) };
}

/** Unlocked discovery on the runner connection; no global-db preflight. */
async function discoverSupplier(ctx: OrgContext, tx: DbTransaction, input: SupplierLocationVersionInput) {
  requireOrgScope(ctx);
  const [location] = await tx.select({ supplierId: supplierLocations.supplierId, isDefault: supplierLocations.isDefault }).from(supplierLocations)
    .where(and(eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.id, input.locationId)));
  if (!location || (input.supplierId !== undefined && input.supplierId !== location.supplierId)) throw partyLocationNotFound("supplier");
  return location;
}

/**
 * Supplier update lock order: discover promotion pairs through tx; facility union
 * FOR SHARE sorted; supplier FOR UPDATE for pairs or promotion, otherwise
 * FOR NO KEY UPDATE; location FOR UPDATE, version; default coercion and demotion;
 * update; pairs with one deferred fill pass on promotion; tx readback; operation
 * afterCommit storage drain. Parent locks never bump its version.
 */
export async function updateSupplierLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: UpdateSupplierLocationInput, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<SupplierLocationWriteOutput> {
  requireOrgScope(ctx);
  const parsed = updateSupplierLocationInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const discovered = await discoverSupplier(ctx, tx, parsed.data);
  const { supplierId } = discovered;
  const { locationId, expectedVersion, supplierId: suppliedParent, ...data } = parsed.data;
  void suppliedParent;
  const { facilityDistances, ...locationData } = data;
  // Discover promotion pairs before taking facilities, then the supplier lock.
  // The location version check below rejects concurrent pair edits.
  const promotionPairs = data.isDefault === true
    ? (await withLocationFacilityDistances(ctx, "supplier", [{ id: locationId }], tx))[0].facilityDistances
    : [];
  // One sorted lock pass: supplied pairs keep their indices; retained promotion
  // pairs the request omitted point at /isDefault.
  await lockLocationFacilities(ctx, tx, facilityDistances, [], {
    facilityIds: promotionPairs.map(row => row.facilityId), pointer: ["isDefault"],
  });
  // Serialize location writers with parent deletion before locking children.
  // Pair saves also wait for intake FK inserts, so fill-only cannot miss an
  // intake committing with a missing distance. The lock does not bump version.
  const [parent] = await tx.select({ id: suppliers.id, code: suppliers.code, archivedAt: suppliers.archivedAt })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, ctx.organizationId)))
    .for(data.facilityDistances?.length || promotionPairs.length || (data.isDefault === true && !discovered.isDefault) ? "update" : "no key update");
  if (!parent) throw partyNotFound("supplier");
  if (parent.archivedAt) throw partyArchived("supplier", parent.code);

  const [locked] = await tx
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .for("update");

  if (!locked) {
    throw partyLocationNotFound("supplier");
  }
  assertRowVersion({
    entity: SUPPLIER_LOCATION_CONFLICT_ENTITY,
    id: locationId,
    expectedVersion,
    actualVersion: locked.version,
  });
  const before = (await withLocationFacilityDistances(ctx, "supplier", [locked], tx))[0];
  // The default moves only by setting another location as default.
  if (locked.isDefault && locationData.isDefault === false) {
    locationData.isDefault = true;
  }

  // Promoting this location to default demotes the supplier's current default.
  if (data.isDefault === true) {
    await demoteDefaultPartyLocation(ctx, tx, { kind: "supplier", parentId: supplierId, exceptLocationId: locationId, captureLocation });
  }

  const [updated] = await tx
    .update(supplierLocations)
    .set({
      ...locationData,
      version: nextVersion(supplierLocations.version),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .returning();

  if (!updated) {
    throw partyLocationNotFound("supplier");
  }

  const promotingDefault = data.isDefault === true && !locked.isDefault;
  // Promotion must lock all eligible feedstocks in one ascending-id pass,
  // matching vehicle edits, rather than filling changed pairs first.
  let fill = await upsertLocationFacilityDistances(ctx, tx, "supplier", locationId, facilityDistances, { deferFill: promotingDefault });
  const result = (await withLocationFacilityDistances(ctx, "supplier", [updated], tx))[0];
  if (promotingDefault) {
    fill = await fillMissingLocationDistances(ctx, tx, "supplier", locationId, result.facilityDistances);
  }
  capture?.(result.id, before, result);
  return { ...result, warnings: locationDistanceFillWarnings("supplier", fill) };
}

/**
 * Supplier delete lock order: supplier FOR NO KEY UPDATE; location FOR UPDATE,
 * version; delete (pairs cascade); if default, next in SUPPLIER_LOCATION_ORDER
 * FOR UPDATE, promote with a version bump. No fill on delete promotion and no
 * parent version bump. Parent discovery is an unlocked tx read.
 */
export async function deleteSupplierLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: SupplierLocationVersionInput, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<SupplierLocationWriteOutput> {
  requireOrgScope(ctx);
  const parsed = supplierLocationVersionInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { supplierId } = await discoverSupplier(ctx, tx, parsed.data);
  const { locationId, expectedVersion } = parsed.data;
  // Serialize location writers with parent deletion before locking children,
  // matching create/update. A lock alone does not change the supplier's version.
  const [parent] = await tx.select({ id: suppliers.id, code: suppliers.code, archivedAt: suppliers.archivedAt })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, ctx.organizationId)))
    .for("no key update");
  if (!parent) throw partyNotFound("supplier");

  if (parent.archivedAt) throw partyArchivedForEdit("supplier", parent.code);

  const [versioned] = await tx.select()
    .from(supplierLocations)
    .where(and(eq(supplierLocations.id, locationId), eq(supplierLocations.supplierId, supplierId), eq(supplierLocations.organizationId, ctx.organizationId)))
    .for("update");
  if (!versioned) throw partyLocationNotFound("supplier");
  assertRowVersion({ entity: SUPPLIER_LOCATION_CONFLICT_ENTITY, id: locationId, expectedVersion, actualVersion: versioned.version });

  const before = (await withLocationFacilityDistances(ctx, "supplier", [versioned], tx))[0];
  const deleted = await tx
    .delete(supplierLocations)
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .returning({
      id: supplierLocations.id,
      supplierId: supplierLocations.supplierId,
      isDefault: supplierLocations.isDefault,
    });

  if (deleted.length === 0) {
    throw partyLocationNotFound("supplier");
  }

  // Deleting the default promotes the first remaining location (in list
  // order) so a supplier with locations always has a default.
  const [gone] = deleted;
  const warnings: string[] = [];
  if (gone.isDefault) {
    const [next] = await tx
      .select()
      .from(supplierLocations)
      .where(
        and(
          eq(supplierLocations.supplierId, gone.supplierId),
          eq(supplierLocations.organizationId, ctx.organizationId),
        ),
      )
      .orderBy(...SUPPLIER_LOCATION_ORDER)
      .limit(1)
      .for("update");
    if (next) {
      const [promoted] = await tx
        .update(supplierLocations)
        .set({ version: nextVersion(supplierLocations.version), isDefault: true, updatedAt: new Date() })
        .where(and(eq(supplierLocations.id, next.id), eq(supplierLocations.organizationId, ctx.organizationId))).returning();
      captureLocation?.(next.id, next, promoted);
      warnings.push(supplierLocationDefaultMovedWarning(promoted.name || promoted.country));
    }
  }

  capture?.(before.id, before, null);
  return { ...before, warnings };
}
