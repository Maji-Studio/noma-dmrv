/**
 * Customer write lock order:
 * Create: named facilities FOR SHARE in id order, then withAutoCodes savepoint:
 * parent with name guard, locations in input order (last explicit default wins,
 * otherwise index zero), pairs and tx readback. New parents have no orders,
 * so pair filling takes no downstream row locks.
 * Update: parent FOR NO KEY UPDATE for metadata, FOR UPDATE for a supplied code,
 * version, code and name guards, update. Children are untouched.
 * Archive/restore: only the parent FOR UPDATE, no child/reference locks.
 * Explicit UPDATE strength conflicts with reference KEY SHARE; no locks follow it,
 * so archive cannot cycle with intake/order, location, update or delete writers.
 * Delete: topology advisory lock first; discover location ids through tx and
 * take their registration fences in id order; order facilities FOR SHARE by
 * id (including archived); customer FOR UPDATE, version; orders FOR UPDATE by id; refuse any delivery, including archived; locations FOR UPDATE by id,
 * mapping check, fence any newly discovered locations; cascade fingerprint;
 * delete each order through its writer; locations, then customer; Activity and
 * after-commit document storage drain are owned by the operation.
 */
import { createHash } from "node:crypto";
import type { ActivityEventInput } from "./activity-events";
import { lockBiocharTransportRouteTopology } from "./transport-legs";
import { tryLockStorageSiteRegistration } from "./customer-location-registration-guards";
import { deleteOrderInTransaction } from "./orders";
import type { CaptureActivity } from "@/lib/activity-changes";
import { and, asc, isNull, isNotNull, sql, eq, inArray } from "drizzle-orm";
import { isPgForeignKeyViolation } from "@/db/errors";
import type { DbTransaction } from "@/db";
import { orders, deliveries, facilities, customers, customerLocations, type Customer, type CustomerLocation } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { partyNotFound, partyArchivedForEdit, partyArchiveConflict, customerHasDeliveries, cascadeChanged, customerHasStorageSites } from "@/lib/party-domain-errors";
import { createCustomerInput, updateCustomerInput, type CreateCustomerInput, type UpdateCustomerInput, type CustomerVersionInput, type DeleteCustomerInput } from "@/schemas/customer-input";
import { validationFailed } from "@/lib/operations/errors";
import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "./code-generator";
import { guardCustomerName } from "./unique-name-guards";
import { assertRowVersion, nextVersion } from "./row-version";
import { lockPartyFacilities } from "./party-reference-guards";
import { withLocationFacilityDistances } from "./location-facility-distances";
import { requireOrgScope } from "./utils";
import { findRegisteredCustomerLocationIds } from "./certifier-storage-locations";
import { createCustomerLocationInTransaction } from "./customer-create";

import { BLOCKER_LIMIT } from "@/config/party-input";

export interface CreatedCustomerWithLocations {
  customer: Customer;
  locations: CustomerLocation[];
}
export async function createCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: CreateCustomerInput & { code: string }, capture?: CaptureActivity, captureLocation?: CaptureActivity): Promise<CreatedCustomerWithLocations> {
  requireOrgScope(ctx);
  const { code, ...body } = input;
  const parsed = createCustomerInput.safeParse(body);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { locations, ...fields } = parsed.data;
  await lockPartyFacilities(ctx, tx, locations);
  // Code violations remain raw so withAutoCodes can roll back and retry its savepoint.
  const [parent] = await guardCustomerName(ctx, tx, fields.name, savepoint => savepoint.insert(customers).values({
    ...fields, code, organizationId: ctx.organizationId,
  }).returning());
  const inserted: CustomerLocation[] = [];
  for (const location of locations) {
    const { siteDescription, ...fields } = location;
    inserted.push((await createCustomerLocationInTransaction(ctx, tx, parent.id, { ...fields, address: siteDescription })).location);
  }
  const saved = await tx.select().from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, parent.id)));
  const enriched = await withLocationFacilityDistances(ctx, "customer", saved, tx);
  capture?.(parent.id, null, parent);
  for (const row of inserted) {
    captureLocation?.(row.id, null, row);
    const final = enriched.find(saved => saved.id === row.id)!;
    if (final.version !== row.version) captureLocation?.(row.id, row, final);
  }
  return { customer: parent, locations: inserted.map(row => enriched.find(saved => saved.id === row.id)!) };
}

export async function updateCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: UpdateCustomerInput, capture?: CaptureActivity): Promise<Customer> {
  requireOrgScope(ctx);
  const parsed = updateCustomerInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { customerId, expectedVersion, ...fields } = parsed.data;
  const [locked] = await tx.select().from(customers).where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId)))
    .for(fields.code === undefined ? "no key update" : "update");
  if (!locked) throw partyNotFound("customer");
  if (locked.archivedAt) throw partyArchivedForEdit("customer", locked.code);
  assertRowVersion({ entity: "customer", id: customerId, expectedVersion, actualVersion: locked.version });
  return withUniqueCodeGuard(ctx, customers, customers.code, CODE_CONFLICT_MESSAGES.customer, () =>
    guardCustomerName(ctx, tx, fields.name ?? locked.name, async savepoint => {
      const [saved] = await savepoint.update(customers).set({ ...fields, version: nextVersion(customers.version), updatedAt: new Date() })
        .where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId))).returning();
      capture?.(saved.id, locked, saved);
      return saved;
    }));
}

export interface DeletedCustomer {
  customer: Customer;
  locations: (typeof customerLocations.$inferSelect)[];
  orders: (typeof orders.$inferSelect)[];
  cascade: { orders: { id: string; code: string }[]; cascadeFingerprint: string };
  warnings: string[];
}

/** Return the locked rows for child Activity and the confirmation preview. */
export async function deleteCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: DeleteCustomerInput, capture?: CaptureActivity, captureLocation?: CaptureActivity, source: ActivityEventInput["source"] = "form"): Promise<DeletedCustomer> {
  requireOrgScope(ctx);
  const { customerId, expectedVersion } = input;
  await lockBiocharTransportRouteTopology(ctx, tx);
  const discovered = await tx.select({ id: customerLocations.id }).from(customerLocations)
    .where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, customerId))).orderBy(asc(customerLocations.id));
  const fenced = new Set<string>();
  for (const { id } of discovered) {
    await tryLockStorageSiteRegistration(ctx, tx, id);
    fenced.add(id);
  }
  // Facilities before the customer, as location saves and order writers take
  // them; topology keeps the order set (and so this facility set) stable.
  const customerOrders = tx.select({ facilityId: orders.facilityId }).from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.customerId, customerId)));
  await tx.select({ id: facilities.id }).from(facilities)
    .where(and(eq(facilities.organizationId, ctx.organizationId), inArray(facilities.id, customerOrders)))
    .orderBy(asc(facilities.id)).for("share");
  const [locked] = await tx.select().from(customers).where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId))).for("update");
  if (!locked) throw partyNotFound("customer");
  assertRowVersion({ entity: "customer", id: customerId, expectedVersion, actualVersion: locked.version });
  const lockedOrders = await tx.select().from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.customerId, customerId)))
    .orderBy(asc(orders.id)).for("update");
  const orderIds = tx.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.customerId, customerId)));
  const uses = await tx.select({ code: deliveries.code }).from(deliveries)
    .where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.orderId, orderIds)))
    .orderBy(asc(deliveries.code)).limit(BLOCKER_LIMIT);
  if (uses.length) throw customerHasDeliveries(uses.map(row => row.code));
  const children = await tx.select().from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, customerId)))
    .orderBy(asc(customerLocations.id)).for("update");
  for (const child of children) {
    const registered = await findRegisteredCustomerLocationIds(ctx, tx, child.id);
    if (registered.length) throw customerHasStorageSites(registered);
  }
  for (const child of children) {
    if (!fenced.has(child.id)) await tryLockStorageSiteRegistration(ctx, tx, child.id);
  }
  const cascade = {
    orders: lockedOrders.map(({ id, code }) => ({ id, code })),
    cascadeFingerprint: "v1:" + createHash("sha256").update(lockedOrders.map(row => row.id).sort().join(",")).digest("hex"),
  };
  if (input.cascadeFingerprint !== undefined && input.cascadeFingerprint !== cascade.cascadeFingerprint) throw cascadeChanged();
  for (const order of lockedOrders) {
    await deleteOrderInTransaction(ctx, tx, { orderId: order.id, expectedVersion: order.version }, source);
  }
  let deletingLocationId: string | undefined;
  try {
    for (const child of children) {
      deletingLocationId = child.id;
      await tx.delete(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.id, child.id)));
    }
    deletingLocationId = undefined;
    await tx.delete(customers).where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId)));
  } catch (error) {
    if (isPgForeignKeyViolation(error, "orders_customer_id_customers_id_fk")) throw customerHasDeliveries();
    if (isPgForeignKeyViolation(error, "orders_customer_location_id_customer_locations_id_fk")) throw customerHasDeliveries();
    // PostgreSQL truncates this composite FK name to NAMEDATALEN - 1 bytes.
    if (isPgForeignKeyViolation(error, "certifier_storage_locations_customer_location_id_organization_i")) throw customerHasStorageSites(deletingLocationId ? [deletingLocationId] : []);
    throw error;
  }
  capture?.(locked.id, locked, null);
  for (const child of children) captureLocation?.(child.id, child, null);
  const shown = lockedOrders.slice(0, BLOCKER_LIMIT).map(row => row.code).join(", ");
  const more = lockedOrders.length > BLOCKER_LIMIT ? ` and ${lockedOrders.length - BLOCKER_LIMIT} more` : "";
  const warnings = lockedOrders.length ? [`Also deleted ${lockedOrders.length} ${lockedOrders.length === 1 ? "order" : "orders"} without deliveries: ${shown}${more}.`] : [];
  return { customer: locked, locations: children, orders: lockedOrders, cascade, warnings };
}

/** Lock only the party, including against reference KEY SHARE locks. */
async function changeCustomerArchiveState(
  ctx: OrgContext,
  tx: DbTransaction,
  { customerId, expectedVersion }: CustomerVersionInput,
  archive: boolean,
  capture?: CaptureActivity,
): Promise<Customer> {
  requireOrgScope(ctx);
  const [locked] = await tx.select().from(customers)
    .where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId))).for("update");
  if (!locked) throw partyNotFound("customer");
  assertRowVersion({ entity: "customer", id: customerId, expectedVersion, actualVersion: locked.version });
  if (Boolean(locked.archivedAt) === archive) throw partyArchiveConflict("customer", locked.code, archive);
  const [saved] = await tx.update(customers).set({
    archivedAt: archive ? sql`now()` : null,
    version: nextVersion(customers.version), updatedAt: sql`now()`,
  }).where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId), archive ? isNull(customers.archivedAt) : isNotNull(customers.archivedAt))).returning();
  if (!saved) throw partyArchiveConflict("customer", locked.code, archive);
  capture?.(saved.id, locked, locked);
  return saved;
}

export async function archiveCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerVersionInput, capture?: CaptureActivity): Promise<Customer> {
  requireOrgScope(ctx);
  return changeCustomerArchiveState(ctx, tx, input, true, capture);
}

export async function restoreCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerVersionInput, capture?: CaptureActivity): Promise<Customer> {
  requireOrgScope(ctx);
  return changeCustomerArchiveState(ctx, tx, input, false, capture);
}
