/** Shared transaction-local customer location insert primitive. */
import { and, count, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { customers, customerLocations, type CustomerLocation } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";
import { partyArchived, partyNotFound } from "@/lib/party-domain-errors";
import { upsertLocationFacilityDistances, withLocationFacilityDistances } from "./location-facility-distances";
import { nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

export interface CustomerLocationInsertInput {
  name: string;
  country: string;
  stateRegion?: string | null;
  city?: string | null;
  gpsLatitude: number;
  gpsLongitude: number;
  address?: string | null;
  facilityDistances?: FacilityDistanceInput[];
  defaultSoilTemperatureC?: number | null;
  isDefault?: boolean;
}

/**
 * Insert one customer location inside an open transaction, keeping the
 * at-most-one-default invariant the partial unique index enforces. The customer
 * is re-checked through `tx` so a customer inserted earlier in the same
 * transaction is visible.
 */
export async function createCustomerLocationInTransaction(
  ctx: OrgContext,
  tx: DbTransaction,
  customerId: string,
  data: CustomerLocationInsertInput,
): Promise<CustomerLocation> {
  requireOrgScope(ctx);

  const [customer] = await tx
    .select({ id: customers.id, code: customers.code, archivedAt: customers.archivedAt })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.organizationId, ctx.organizationId),
      ),
    )
    // Match deletion and location updates: parent before children.
    .for("no key update");

  if (!customer) {
    throw partyNotFound("customer");
  }

  if (customer.archivedAt) throw partyArchived("customer", customer.code);

  // The customer's first location is always its default.
  const [{ value: existingCount }] = await tx
    .select({ value: count() })
    .from(customerLocations)
    .where(
      and(
        eq(customerLocations.customerId, customerId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ),
    );
  const makeDefault = data.isDefault === true || existingCount === 0;

  // Clear the prior default first so the partial unique index never sees two.
  if (makeDefault) {
    await tx
      .update(customerLocations)
      .set({ version: nextVersion(customerLocations.version), isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(customerLocations.customerId, customerId),
          eq(customerLocations.organizationId, ctx.organizationId),
          eq(customerLocations.isDefault, true),
        ),
      );
  }

  const [location] = await tx
    .insert(customerLocations)
    .values({
      organizationId: ctx.organizationId,
      customerId,
      name: data.name,
      country: data.country,
      stateRegion: data.stateRegion ?? null,
      city: data.city ?? null,
      gpsLatitude: data.gpsLatitude,
      gpsLongitude: data.gpsLongitude,
      address: data.address ?? null,
      defaultSoilTemperatureC: data.defaultSoilTemperatureC ?? null,
      isDefault: makeDefault,
    })
    .returning();

  await upsertLocationFacilityDistances(ctx, tx, "customer", location.id, data.facilityDistances);
  return (await withLocationFacilityDistances(ctx, "customer", [location], tx))[0];
}
