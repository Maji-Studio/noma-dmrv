import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { customers, customerLocations, type CustomerLocation } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CaptureActivity } from "@/lib/activity-changes";
import { customerLocationDefaultMovedWarning, locationDistanceFillWarnings } from "@/lib/location-write-warnings";
import type { CaptureFilledDelivery } from "./location-distance-fill";
import { partyNotFound, partyLocationNotFound, partyArchived, partyArchivedForEdit, customerLocationArchivedForEdit, customerLocationHasOrders, customerLocationHasStorageSite } from "@/lib/party-domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { addCustomerLocationInput, updateCustomerLocationInput, customerLocationVersionInput, type AddCustomerLocationInput, type UpdateCustomerLocationInput, type CustomerLocationVersionInput } from "@/schemas/customer-location-input";
import { lockLocationFacilities } from "./party-reference-guards";
import { upsertLocationFacilityDistances, withLocationFacilityDistances } from "./location-facility-distances";
import { assertRowVersion, nextVersion } from "./row-version";
import { CUSTOMER_LOCATION_ORDER } from "./customers";
import { requireOrgScope } from "./utils";
import { demoteDefaultPartyLocation } from "./party-location-default";

import { createCustomerLocationInTransaction } from "./customer-create";
import { lockBiocharTransportRouteTopology } from "./transport-legs";
import { tryLockStorageSiteRegistration, assertRegisteredStorageSiteUnchanged } from "./customer-location-registration-guards";
import { findCustomerLocationBlockers } from "./customer-location-reference-guards";
import { isPgForeignKeyViolation } from "@/db/errors";

const CUSTOMER_LOCATION_CONFLICT_ENTITY = "customerLocation";

export type CustomerLocationWriteOutput = CustomerLocation & { warnings: string[] };

/**
 * Customer add lock order: non-null facilities FOR SHARE sorted; customer FOR
 * NO KEY UPDATE; demote default with version bump; insert; pairs (no deliveries
 * exist for a new location); tx readback. No topology or registration fence.
 * Parent version is unchanged.
 */
export async function addCustomerLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: AddCustomerLocationInput, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<CustomerLocationWriteOutput> {
  requireOrgScope(ctx);
  const parsed = addCustomerLocationInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { customerId, ...data } = parsed.data;
  const { location: saved, fill } = await createCustomerLocationInTransaction(ctx, tx, customerId, data, captureLocation);
  capture?.(saved.id, null, saved);
  return { ...saved, warnings: locationDistanceFillWarnings("customer", fill) };
}

/** Unlocked discovery on the runner connection; no global-db preflight. */
async function discoverCustomer(ctx: OrgContext, tx: DbTransaction, input: CustomerLocationVersionInput) {
  requireOrgScope(ctx);
  const [location] = await tx.select({ customerId: customerLocations.customerId, isDefault: customerLocations.isDefault }).from(customerLocations)
    .where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.id, input.locationId)));
  if (!location || (input.customerId !== undefined && input.customerId !== location.customerId)) throw partyLocationNotFound("customer");
  return location;
}

/**
 * Customer update lock order: topology for name, GPS or pairs; facilities FOR
 * SHARE sorted; registration try-lock for name or GPS; customer NO KEY UPDATE;
 * location FOR UPDATE and version; tx mapping check; demotion; update; pairs and
 * delivery fill (artifacts, deliveries, product legs); tx readback. Storage drains
 * after commit. Discovery is unlocked through tx; parent version is unchanged.
 * Known wait outside Postgres deadlock detection: removal recovery holds a
 * removal artifact lock and then blocks on the site fence in registration, while
 * this writer holds the fence and can wait for that artifact in the fill. The
 * pool's lock_timeout breaks it (55P03, retried by the runner).
 */
export async function updateCustomerLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: UpdateCustomerLocationInput, capture?: CaptureActivity, captureLocation?: CaptureActivity, captureDelivery?: CaptureFilledDelivery): Promise<CustomerLocationWriteOutput> {
  requireOrgScope(ctx);
  const parsed = updateCustomerLocationInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const discovered = await discoverCustomer(ctx, tx, parsed.data);
  const { customerId } = discovered;
  const { locationId, expectedVersion, customerId: suppliedParent, ...data } = parsed.data;
  void suppliedParent;
  const { facilityDistances, ...locationData } = data;
  const siteFactsSupplied = data.name !== undefined || data.gpsLatitude !== undefined || data.gpsLongitude !== undefined;
  if (siteFactsSupplied || facilityDistances !== undefined) await lockBiocharTransportRouteTopology(ctx, tx);
  await lockLocationFacilities(ctx, tx, facilityDistances, []);
  if (siteFactsSupplied) await tryLockStorageSiteRegistration(ctx, tx, locationId);
  const [parent] = await tx.select({ id: customers.id, code: customers.code, archivedAt: customers.archivedAt })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
    .for("no key update");
  if (!parent) throw partyNotFound("customer");
  if (parent.archivedAt) throw partyArchived("customer", parent.code);

  const [locked] = await tx
    .select()
    .from(customerLocations)
    .where(
      and(
        eq(customerLocations.id, locationId),
        eq(customerLocations.customerId, customerId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .for("update");

  if (!locked) {
    throw partyLocationNotFound("customer");
  }
  if (locked.archivedAt) throw customerLocationArchivedForEdit(locked.name);
  assertRowVersion({
    entity: CUSTOMER_LOCATION_CONFLICT_ENTITY,
    id: locationId,
    expectedVersion,
    actualVersion: locked.version,
  });
  await assertRegisteredStorageSiteUnchanged(ctx, tx, locked, data);
  const before = (await withLocationFacilityDistances(ctx, "customer", [locked], tx))[0];
  // The default moves only by setting another location as default.
  if (locked.isDefault && locationData.isDefault === false) {
    locationData.isDefault = true;
  }

  // Promoting this location to default demotes the customer's current default.
  if (data.isDefault === true) {
    await demoteDefaultPartyLocation(ctx, tx, { kind: "customer", parentId: customerId, exceptLocationId: locationId, captureLocation });
  }

  const [updated] = await tx
    .update(customerLocations)
    .set({
      ...locationData,
      version: nextVersion(customerLocations.version),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customerLocations.id, locationId),
        eq(customerLocations.customerId, customerId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .returning();

  if (!updated) {
    throw partyLocationNotFound("customer");
  }

  const fill = await upsertLocationFacilityDistances(ctx, tx, "customer", locationId, facilityDistances, { captureDelivery });
  const result = (await withLocationFacilityDistances(ctx, "customer", [updated], tx))[0];
  capture?.(result.id, before, result);
  return { ...result, warnings: locationDistanceFillWarnings("customer", fill) };
}

/**
 * Customer delete lock order: registration try-lock; customer NO KEY UPDATE;
 * location FOR UPDATE and version; tx order and mapping blockers; delete
 * (pairs cascade); if default, next in CUSTOMER_LOCATION_ORDER
 * FOR UPDATE, promote with a version bump. No fill on delete promotion and no
 * parent version bump. Parent discovery is an unlocked tx read.
 */
export async function deleteCustomerLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerLocationVersionInput, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<CustomerLocationWriteOutput> {
  requireOrgScope(ctx);
  const parsed = customerLocationVersionInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { customerId } = await discoverCustomer(ctx, tx, parsed.data);
  const { locationId, expectedVersion } = parsed.data;
  await tryLockStorageSiteRegistration(ctx, tx, locationId);
  // Serialize location writers with parent deletion before locking children,
  // matching create/update. A lock alone does not change the customer's version.
  const [parent] = await tx.select({ id: customers.id, code: customers.code, archivedAt: customers.archivedAt })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
    .for("no key update");
  if (!parent) throw partyNotFound("customer");

  if (parent.archivedAt) throw partyArchivedForEdit("customer", parent.code);

  const [versioned] = await tx.select()
    .from(customerLocations)
    .where(and(eq(customerLocations.id, locationId), eq(customerLocations.customerId, customerId), eq(customerLocations.organizationId, ctx.organizationId)))
    .for("update");
  if (!versioned) throw partyLocationNotFound("customer");
  assertRowVersion({ entity: CUSTOMER_LOCATION_CONFLICT_ENTITY, id: locationId, expectedVersion, actualVersion: versioned.version });

  const before = (await withLocationFacilityDistances(ctx, "customer", [versioned], tx))[0];
  const blockers = await findCustomerLocationBlockers(ctx, tx, locationId);
  const archived = versioned.archivedAt !== null;
  if (blockers.orderCodes.length) throw customerLocationHasOrders(blockers.orderCodes, archived);
  if (blockers.registeredLocationIds.length) throw customerLocationHasStorageSite(archived);
  const deleted = await tx
    .delete(customerLocations)
    .where(
      and(
        eq(customerLocations.id, locationId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    )
    .returning({
      id: customerLocations.id,
      customerId: customerLocations.customerId,
      isDefault: customerLocations.isDefault,
    }).catch((error: unknown) => {
      if (isPgForeignKeyViolation(error, "orders_customer_location_id_customer_locations_id_fk")) throw customerLocationHasOrders([], archived);
      if (isPgForeignKeyViolation(error, "certifier_storage_locations_customer_location_id_organization_i")) throw customerLocationHasStorageSite(archived);
      throw error;
    });

  if (deleted.length === 0) {
    throw partyLocationNotFound("customer");
  }

  // Deleting the default promotes the first remaining location (in list
  // order) so a customer with locations always has a default.
  const [gone] = deleted;
  const warnings: string[] = [];
  if (gone.isDefault) {
    const [next] = await tx
      .select()
      .from(customerLocations)
      .where(
        and(
          eq(customerLocations.customerId, gone.customerId),
          isNull(customerLocations.archivedAt),
          eq(customerLocations.organizationId, ctx.organizationId),
        ),
      )
      .orderBy(...CUSTOMER_LOCATION_ORDER)
      .limit(1)
      .for("update");
    if (next) {
      const [promoted] = await tx
        .update(customerLocations)
        .set({ version: nextVersion(customerLocations.version), isDefault: true, updatedAt: new Date() })
        .where(and(eq(customerLocations.id, next.id), eq(customerLocations.organizationId, ctx.organizationId))).returning();
      captureLocation?.(next.id, next, promoted);
      warnings.push(customerLocationDefaultMovedWarning(promoted.name));
    }
  }

  capture?.(before.id, before, null);
  return { ...before, warnings };
}

export { archiveCustomerLocationInTransaction, restoreCustomerLocationInTransaction } from "./customer-location-archive";
