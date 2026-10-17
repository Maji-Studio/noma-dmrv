import { and, eq, isNull, isNotNull, ne, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { customers, customerLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CaptureActivity } from "@/lib/activity-changes";
import { partyNotFound, partyLocationNotFound, partyArchivedForEdit, customerLocationArchiveConflict, customerLocationLastActive } from "@/lib/party-domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { customerLocationVersionInput, type CustomerLocationVersionInput } from "@/schemas/customer-location-input";
import { customerLocationDefaultMovedWarning } from "@/lib/location-write-warnings";
import type { CustomerLocationWriteOutput } from "./customer-location-writes";
import { CUSTOMER_LOCATION_ORDER } from "./customers";
import { withLocationFacilityDistances } from "./location-facility-distances";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

/**
 * Archive/restore: unlocked parent discovery; customer NO KEY UPDATE; location
 * explicit FOR UPDATE (waits for order KEY SHARE); version, state. Archive counts
 * active siblings under the parent lock, locks the first NO KEY UPDATE, demotes
 * self then promotes it with a bump. Restore takes the default only if absent.
 * Parent version stays unchanged. No topology, registration fence or distance fill.
 */
async function changeArchiveState(ctx: OrgContext, tx: DbTransaction, input: CustomerLocationVersionInput, archive: boolean, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<CustomerLocationWriteOutput> {
  requireOrgScope(ctx);
  const parsed = customerLocationVersionInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { locationId, expectedVersion, customerId } = parsed.data;
  const locationWhere = eq(customerLocations.id, locationId);
  const [discovered] = await tx.select({ customerId: customerLocations.customerId }).from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), locationWhere));
  if (!discovered || (customerId !== undefined && customerId !== discovered.customerId)) throw partyLocationNotFound("customer");
  const [parent] = await tx.select().from(customers)
    .where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, discovered.customerId))).for("no key update");
  if (!parent) throw partyNotFound("customer");
  if (parent.archivedAt) throw partyArchivedForEdit("customer", parent.code);
  const [locked] = await tx.select().from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), locationWhere)).for("update");
  if (!locked) throw partyLocationNotFound("customer");
  assertRowVersion({ entity: "customerLocation", id: locationId, expectedVersion, actualVersion: locked.version });
  if (Boolean(locked.archivedAt) === archive) throw customerLocationArchiveConflict(locked.name, archive);
  const activeWhere = and(eq(customerLocations.customerId, parent.id), isNull(customerLocations.archivedAt));
  const warnings: string[] = [];
  let isDefault = false;
  if (archive) {
    const siblings = await tx.select({ id: customerLocations.id }).from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), activeWhere, ne(customerLocations.id, locationId)));
    if (!siblings.length) throw customerLocationLastActive(locked.name);
    if (locked.isDefault) {
      const [next] = await tx.select().from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), activeWhere, ne(customerLocations.id, locationId)))
        .orderBy(...CUSTOMER_LOCATION_ORDER).limit(1).for("no key update");
      await tx.update(customerLocations).set({ isDefault: false }).where(and(eq(customerLocations.organizationId, ctx.organizationId), locationWhere));
      const [promoted] = await tx.update(customerLocations).set({ isDefault: true, version: nextVersion(customerLocations.version), updatedAt: sql`now()` })
        .where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.id, next.id))).returning();
      captureLocation?.(next.id, next, promoted);
      warnings.push(customerLocationDefaultMovedWarning(promoted.name));
    }
  } else {
    const [currentDefault] = await tx.select({ id: customerLocations.id }).from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), activeWhere, eq(customerLocations.isDefault, true))).limit(1);
    isDefault = !currentDefault;
  }
  const [saved] = await tx.update(customerLocations).set({ archivedAt: archive ? sql`now()` : null, isDefault,
    version: nextVersion(customerLocations.version), updatedAt: sql`now()` })
    .where(and(eq(customerLocations.organizationId, ctx.organizationId), locationWhere, archive ? isNull(customerLocations.archivedAt) : isNotNull(customerLocations.archivedAt))).returning();
  if (!saved) throw customerLocationArchiveConflict(locked.name, archive);
  // Status Activity has no changed fields, including the default demotion.
  capture?.(saved.id, locked, locked);
  const result = (await withLocationFacilityDistances(ctx, "customer", [saved], tx))[0];
  return { ...result, warnings };
}

export async function archiveCustomerLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerLocationVersionInput, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<CustomerLocationWriteOutput> {
  requireOrgScope(ctx);
  return changeArchiveState(ctx, tx, input, true, capture, captureLocation);
}

export async function restoreCustomerLocationInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerLocationVersionInput, capture?: CaptureActivity): Promise<CustomerLocationWriteOutput> {
  requireOrgScope(ctx);
  return changeArchiveState(ctx, tx, input, false, capture);
}
