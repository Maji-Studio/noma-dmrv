/**
 * Customer create writers.
 *
 * A customer and the locations captured on its create form are one operator
 * intent, so they commit together or not at all. The transaction-accepting
 * primitives below are the single implementation: `customers.ts` wraps them for
 * the single-record create paths, and `createCustomerWithLocations` reuses them
 * inside one transaction for the compound create.
 */

import { and, count, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  customers,
  customerLocations,
  type Customer,
  type CustomerLocation,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { guardCustomerName } from "./unique-name-guards";
import { requireOrgScope } from "./utils";

/**
 * Locations are identified by their GPS position, and the country column is
 * NOT NULL, so an unstated country is stored as this placeholder rather than
 * blocking the write.
 */
const UNKNOWN_COUNTRY = "UNKNOWN";

/** Any executor that can run a customer write: the pool or an open transaction. */
type CustomerWriteExecutor = typeof db | DbTransaction;

export interface CustomerInsertInput {
  code: string;
  name: string;
  cropType?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export interface CustomerLocationInsertInput {
  name: string;
  country?: string;
  stateRegion?: string | null;
  city?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  address?: string | null;
  distanceFromFacilityKm?: number | null;
  distanceSource?: DistanceSourceValue | null;
  defaultSoilTemperatureC?: number | null;
  isDefault?: boolean;
}

export interface CreateCustomerWithLocationsInput {
  customer: CustomerInsertInput;
  locations: CustomerLocationInsertInput[];
}

export interface CreatedCustomerWithLocations {
  customer: Customer;
  locations: CustomerLocation[];
}

/**
 * Insert one customer row through `executor`. Pass the pool for a standalone
 * create, or an open transaction to commit alongside other writes.
 */
export async function insertCustomer(
  ctx: OrgContext,
  executor: CustomerWriteExecutor,
  data: CustomerInsertInput,
): Promise<Customer> {
  requireOrgScope(ctx);

  const [customer] = await guardCustomerName(ctx, data.name, () =>
    executor
      .insert(customers)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        name: data.name,
        cropType: data.cropType ?? null,
        address: data.address ?? null,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
      })
      .returning(),
  );

  return customer;
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
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.organizationId, ctx.organizationId),
      ),
    );

  if (!customer) {
    throw new SafeError("Customer not found");
  }

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
      .set({ isDefault: false, updatedAt: new Date() })
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
      country: data.country ?? UNKNOWN_COUNTRY,
      stateRegion: data.stateRegion ?? null,
      city: data.city ?? null,
      gpsLatitude: data.gpsLatitude ?? null,
      gpsLongitude: data.gpsLongitude ?? null,
      address: data.address ?? null,
      distanceFromFacilityKm: data.distanceFromFacilityKm ?? null,
      distanceSource: data.distanceSource ?? null,
      defaultSoilTemperatureC: data.defaultSoilTemperatureC ?? null,
      isDefault: makeDefault,
    })
    .returning();

  return location;
}

/**
 * Create a customer and every location captured on its create form in ONE
 * transaction. A failure on any location rolls the customer back too, so the
 * operator never keeps a half-saved customer after the form reports a failure.
 *
 * Locations are inserted in order because each one reads the customer's current
 * default to decide whether it becomes the new default.
 */
export async function createCustomerWithLocations(
  ctx: OrgContext,
  input: CreateCustomerWithLocationsInput,
): Promise<CreatedCustomerWithLocations> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const customer = await insertCustomer(ctx, tx, input.customer);

    const locations: CustomerLocation[] = [];
    for (const location of input.locations) {
      locations.push(
        await createCustomerLocationInTransaction(ctx, tx, customer.id, location),
      );
    }

    return { customer, locations };
  });
}
