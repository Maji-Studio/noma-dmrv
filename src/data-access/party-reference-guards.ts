import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { suppliers, customers } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { DomainIssue } from "@/lib/domain-errors";
import { partyArchived, partyNotFound, partyRefusal } from "@/lib/party-domain-errors";
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

/** Acquire the complete facility set before inserting the parent or any child. */
export async function lockPartyFacilities(ctx: OrgContext, tx: DbTransaction, locations: { facilityDistances?: FacilityDistanceInput[] }[]): Promise<void> {
  requireOrgScope(ctx);
  const references = locations.flatMap((location, i) => (location.facilityDistances ?? []).map((pair, j) => ({ id: pair.facilityId, path: ["locations", i, "facilityDistances", j, "facilityId"] })));
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
