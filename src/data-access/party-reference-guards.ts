import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { suppliers, customers, customerLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { orderReferenceNotFound } from "@/lib/order-domain-errors";
import type { DomainIssue } from "@/lib/domain-errors";
import { customerLocationArchived, partyArchived, partyNotFound, partyRefusal } from "@/lib/party-domain-errors";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { requireOrgScope } from "./utils";

type ReferenceOptions = { pointer?: DomainIssue["path"]; allowArchived?: boolean };

/** Hold references through commit. Kept references defer the archive check. */
export async function lockSupplierReference(ctx: OrgContext, tx: DbTransaction, supplierId: string, options: ReferenceOptions = {}) {
  requireOrgScope(ctx);
  const pointer = options.pointer ?? ["supplierId"];
  const [supplier] = await tx.select({ id: suppliers.id, code: suppliers.code, archivedAt: suppliers.archivedAt }).from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.id, supplierId))).for("key share");
  if (!supplier) throw partyNotFound("supplier", pointer);
  if (supplier.archivedAt && !options.allowArchived) throw partyArchived("supplier", supplier.code, pointer);
  return supplier;
}

export async function lockCustomerReference(ctx: OrgContext, tx: DbTransaction, customerId: string, options: ReferenceOptions = {}) {
  requireOrgScope(ctx);
  const pointer = options.pointer ?? ["customerId"];
  const [customer] = await tx.select({ id: customers.id, code: customers.code, archivedAt: customers.archivedAt }).from(customers)
    .where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.id, customerId))).for("key share");
  if (!customer) throw partyNotFound("customer", pointer);
  if (customer.archivedAt && !options.allowArchived) throw partyArchived("customer", customer.code, pointer);
  return customer;
}

/**
 * Lock non-null references in id order, retaining the caller's input pointers.
 * Retained references (stored pairs a default promotion fills from) join the
 * same sorted pass and point at `retained.pointer`, since the request omitted them.
 */
export async function lockLocationFacilities(
  ctx: OrgContext, tx: DbTransaction, pairs: FacilityDistanceInput[] | undefined,
  pointerPrefix: DomainIssue["path"],
  retained: { facilityIds: string[]; pointer: DomainIssue["path"] } = { facilityIds: [], pointer: [] },
): Promise<void> {
  requireOrgScope(ctx);
  const supplied = (pairs ?? []).flatMap((pair, j) => pair.distanceKm === null ? [] : [{
    id: pair.facilityId, path: [...pointerPrefix, "facilityDistances", j, "facilityId"],
  }]);
  const suppliedIds = new Set((pairs ?? []).map(pair => pair.facilityId));
  const references = [...supplied, ...retained.facilityIds.filter(id => !suppliedIds.has(id)).map(id => ({ id, path: retained.pointer }))];
  references.sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const reference of references) {
    if (seen.has(reference.id)) continue;
    try { await lockActiveFacilityReference(ctx, tx, reference.id); }
    catch (error) {
      if (error instanceof SafeError) throw partyRefusal("not_found", error.message, reference.path);
      throw error;
    }
    seen.add(reference.id);
  }
}

/** Acquire each location's facility set before inserting the parent or children. */
export async function lockPartyFacilities(ctx: OrgContext, tx: DbTransaction, locations: { facilityDistances?: FacilityDistanceInput[] }[]): Promise<void> {
  requireOrgScope(ctx);
  for (const [i, location] of locations.entries()) {
    await lockLocationFacilities(ctx, tx, location.facilityDistances, ["locations", i]);
  }
}

/** Archive takes FOR UPDATE, so a new reference waits for its final state. */
export async function lockCustomerLocationReference(ctx: OrgContext, tx: DbTransaction, locationId: string, options: ReferenceOptions = {}) {
  requireOrgScope(ctx);
  const pointer = options.pointer ?? ["customerLocationId"];
  const [location] = await tx.select({ customerId: customerLocations.customerId, name: customerLocations.name, archivedAt: customerLocations.archivedAt })
    .from(customerLocations).where(and(eq(customerLocations.organizationId, ctx.organizationId), eq(customerLocations.id, locationId))).for("key share");
  if (!location) {
    const missing = orderReferenceNotFound("customerLocationId");
    throw partyRefusal("not_found", missing.message, pointer);
  }
  if (location.archivedAt && !options.allowArchived) throw customerLocationArchived(location.name, pointer);
  return location;
}
