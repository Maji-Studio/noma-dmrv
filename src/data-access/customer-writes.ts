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
 * Delete: parent FOR UPDATE, version, order check, children FOR UPDATE in id
 * order, child reference checks, delete children then parent.
 * Orders take customer then location KEY SHARE. Registration takes location
 * FK KEY SHARE. Deletes never lock orders or certification artifacts.
 * Pair saves take facility then parent locks. Creates fill only new parents;
 * updates and deletes never request facility or downstream locks, so no reverse
 * edge is introduced against pair writers, facility archive or formulation writes.
 */
import { and, asc, isNull, isNotNull, sql, eq } from "drizzle-orm";
import { isPgForeignKeyViolation } from "@/db/errors";
import type { DbTransaction } from "@/db";
import { orders, customers, customerLocations, type Customer, type CustomerLocation } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { partyNotFound, partyArchivedForEdit, partyArchiveConflict, customerHasOrders, customerHasStorageSites } from "@/lib/party-domain-errors";
import { createCustomerInput, updateCustomerInput, type CreateCustomerInput, type UpdateCustomerInput, type CustomerVersionInput } from "@/schemas/customer-input";
import { validationFailed } from "@/lib/operations/errors";
import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "./code-generator";
import { guardCustomerName } from "./unique-name-guards";
import { assertRowVersion, nextVersion } from "./row-version";
import { lockPartyFacilities } from "./party-reference-guards";
import { withLocationFacilityDistances } from "./location-facility-distances";
import { requireOrgScope } from "./utils";
import { findCustomerLocationBlockers } from "./customer-location-reference-guards";
import { createCustomerLocationInTransaction } from "./customer-create";

import { BLOCKER_LIMIT } from "@/config/party-input";

export interface CreatedCustomerWithLocations {
  customer: Customer;
  locations: CustomerLocation[];
}
export async function createCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: CreateCustomerInput & { code: string }): Promise<CreatedCustomerWithLocations> {
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
    inserted.push(await createCustomerLocationInTransaction(ctx, tx, parent.id, { ...fields, address: siteDescription }));
  }
  const saved = await tx.select().from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, parent.id)));
  const enriched = await withLocationFacilityDistances(ctx, "customer", saved, tx);
  return { customer: parent, locations: inserted.map(row => enriched.find(saved => saved.id === row.id)!) };
}

export async function updateCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: UpdateCustomerInput): Promise<Customer> {
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
      return saved;
    }));
}

/** Return deleted locations so the operation can record each child event. */
export async function deleteCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerVersionInput): Promise<(typeof customerLocations.$inferSelect)[]> {
  requireOrgScope(ctx);
  const { customerId, expectedVersion } = input;
  const [locked] = await tx.select().from(customers).where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId))).for("update");
  if (!locked) throw partyNotFound("customer");
  assertRowVersion({ entity: "customer", id: customerId, expectedVersion, actualVersion: locked.version });
  const uses = await tx.select({ code: orders.code }).from(orders)
    .where(and(eq(orders.organizationId, ctx.organizationId), eq(orders.customerId, customerId)))
    .orderBy(asc(orders.code)).limit(BLOCKER_LIMIT);
  if (uses.length) throw customerHasOrders(uses.map(row => row.code));
  const children = await tx.select().from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.customerId, customerId)))
    .orderBy(asc(customerLocations.id)).for("update");
  for (const child of children) {
    const blockers = await findCustomerLocationBlockers(ctx, tx, child.id);
    if (blockers.orderCodes.length) throw customerHasOrders(blockers.orderCodes);
    if (blockers.registeredLocationIds.length) throw customerHasStorageSites(blockers.registeredLocationIds);
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
    if (isPgForeignKeyViolation(error, "orders_customer_id_customers_id_fk")) throw customerHasOrders();
    if (isPgForeignKeyViolation(error, "orders_customer_location_id_customer_locations_id_fk")) throw customerHasOrders();
    // PostgreSQL truncates this composite FK name to NAMEDATALEN - 1 bytes.
    if (isPgForeignKeyViolation(error, "certifier_storage_locations_customer_location_id_organization_i")) throw customerHasStorageSites(deletingLocationId ? [deletingLocationId] : []);
    throw error;
  }
  return children;
}

/** Lock only the party, including against reference KEY SHARE locks. */
async function changeCustomerArchiveState(
  ctx: OrgContext,
  tx: DbTransaction,
  { customerId, expectedVersion }: CustomerVersionInput,
  archive: boolean,
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
  return saved;
}

export async function archiveCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerVersionInput): Promise<Customer> {
  requireOrgScope(ctx);
  return changeCustomerArchiveState(ctx, tx, input, true);
}

export async function restoreCustomerInTransaction(ctx: OrgContext, tx: DbTransaction, input: CustomerVersionInput): Promise<Customer> {
  requireOrgScope(ctx);
  return changeCustomerArchiveState(ctx, tx, input, false);
}
