/**
 * Customers Data Access Layer
 * CRUD operations for customers and customer locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  customers,
  customerLocations,
  orders,
  type Customer,
  type CustomerLocation,
} from "@/db/schema";
import type { CustomerFilterData } from "@/schemas/customers";
import type { DistanceSourceValue } from "@/schemas/distance-source";

// ============================================
// Types
// ============================================

export interface CustomerWithRelations extends Customer {
  locationCount: number;
}

export interface PaginatedCustomers {
  items: CustomerWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CustomerLocationDetail extends CustomerLocation {
  customer: {
    id: string;
    code: string;
    name: string;
  };
}

// ============================================
// Auth Guards
// ============================================

import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { guardCustomerName } from "./unique-name-guards";
import {
  lockBiocharTransportRouteTopology,
  syncBiocharLegsForCustomerLocation,
} from "./transport-legs";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";
import {
  findCustomerWithRelations,
  type CustomerDetail,
} from "./customer-detail";
import {
  createCustomerLocationInTransaction,
  insertCustomer,
  type CustomerInsertInput,
  type CustomerLocationInsertInput,
} from "./customer-create";

export type { CustomerDetail } from "./customer-detail";
export {
  createCustomerWithLocations,
  type CreateCustomerWithLocationsInput,
  type CreatedCustomerWithLocations,
  type CustomerInsertInput,
  type CustomerLocationInsertInput,
} from "./customer-create";

// ============================================
// Customer Read Operations
// ============================================

/**
 * Get all customers with pagination and filtering
 * Supports search, crop type filter, sorting, and pagination
 */
export async function getCustomers(
  ctx: OrgContext,
  filters?: Partial<CustomerFilterData>
): Promise<PaginatedCustomers> {
  requireOrgScope(ctx);

  const {
    search,
    cropType,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [eq(customers.organizationId, ctx.organizationId)];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(customers.code, searchPattern),
        ilike(customers.name, searchPattern),
        ilike(customers.cropType, searchPattern)
      )!
    );
  }

  if (cropType) {
    conditions.push(ilike(customers.cropType, cropType));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: customers.code,
    name: customers.name,
    cropType: customers.cropType,
    createdAt: customers.createdAt,
    updatedAt: customers.updatedAt,
  }[sortBy] ?? customers.name;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  // org-scope-ok: whereClause includes the active organization predicate.
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(customers)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get customers
  const customerList = await db
    .select({
      id: customers.id,
      organizationId: customers.organizationId,
      code: customers.code,
      name: customers.name,
      cropType: customers.cropType,
      address: customers.address,
      contactEmail: customers.contactEmail,
      contactPhone: customers.contactPhone,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
    })
    .from(customers)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Get location counts for each customer
  const customerIds = customerList.map((c) => c.id);

  const locationCounts =
    customerIds.length > 0
      ? await db
          .select({
            customerId: customerLocations.customerId,
            count: count(),
          })
          .from(customerLocations)
          .where(and(inArray(customerLocations.customerId, customerIds), eq(customerLocations.organizationId, ctx.organizationId)))
          .groupBy(customerLocations.customerId)
      : [];

  // Create maps for quick lookup
  const locationCountMap = new Map(
    locationCounts.map((l) => [l.customerId, Number(l.count)])
  );

  // Combine data
  const items: CustomerWithRelations[] = customerList.map((c) => ({
    ...c,
    locationCount: locationCountMap.get(c.id) ?? 0,
  }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Get a single customer by ID
 * Returns customer data without relations
 */
export async function getCustomerById(
  ctx: OrgContext,
  customerId: string
): Promise<Customer> {
  requireOrgScope(ctx);

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)));

  if (!customer) {
    throw new SafeError("Customer not found");
  }

  return customer;
}

/**
 * Get a single customer with all its relationships
 * Includes locations
 */
export async function getCustomerWithRelations(
  ctx: OrgContext,
  customerId: string
): Promise<CustomerDetail> {
  const customer = await findCustomerWithRelations(ctx, customerId);

  if (!customer) {
    throw new SafeError("Customer not found");
  }

  return customer;
}

/**
 * Get locations associated with a customer
 */
export async function getCustomerLocations(
  ctx: OrgContext,
  customerId: string
): Promise<
  Array<{
    id: string;
    name: string | null;
    country: string;
    stateRegion: string | null;
    city: string | null;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    address: string | null;
    distanceFromFacilityKm: number | null;
    distanceSource: DistanceSourceValue | null;
    defaultSoilTemperatureC: number | null;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
  requireOrgScope(ctx);

  // Verify customer exists
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)));

  if (!customer) {
    throw new SafeError("Customer not found");
  }

  return db
    .select({
      id: customerLocations.id,
      name: customerLocations.name,
      country: customerLocations.country,
      stateRegion: customerLocations.stateRegion,
      city: customerLocations.city,
      gpsLatitude: customerLocations.gpsLatitude,
      gpsLongitude: customerLocations.gpsLongitude,
      address: customerLocations.address,
      distanceFromFacilityKm: customerLocations.distanceFromFacilityKm,
      distanceSource: customerLocations.distanceSource,
      defaultSoilTemperatureC: customerLocations.defaultSoilTemperatureC,
      isDefault: customerLocations.isDefault,
      createdAt: customerLocations.createdAt,
      updatedAt: customerLocations.updatedAt,
    })
    .from(customerLocations)
    .where(and(eq(customerLocations.customerId, customerId), eq(customerLocations.organizationId, ctx.organizationId)))
    .orderBy(sql`${customerLocations.name} asc nulls last`);
}

// ============================================
// Customer Create Operations
// ============================================

/**
 * Create a new customer on its own. Customers created together with their
 * locations go through `createCustomerWithLocations` instead.
 */
export async function createCustomer(
  ctx: OrgContext,
  data: CustomerInsertInput
): Promise<Customer> {
  return insertCustomer(ctx, db, data);
}

// ============================================
// Customer Update Operations
// ============================================

/**
 * Update an existing customer
 */
export async function updateCustomer(
  ctx: OrgContext,
  customerId: string,
  data: {
    code?: string;
    name?: string;
    cropType?: string | null;
    address?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  }
): Promise<Customer> {
  requireOrgScope(ctx);

  // Verify customer exists
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Customer not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.code, data.code), eq(customers.organizationId, ctx.organizationId)));

    if (duplicate) {
      throw new SafeError("A customer with this code already exists");
    }
  }

  const [updated] = await guardCustomerName(
    ctx,
    data.name ?? existing.name,
    () =>
      db
        .update(customers)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
        .returning()
  );

  return updated;
}

// ============================================
// Customer Delete Operations
// ============================================

/**
 * Delete a customer
 * Will fail if customer has associated locations
 */
export async function deleteCustomer(
  ctx: OrgContext,
  customerId: string
): Promise<void> {
  requireOrgScope(ctx);

  // Verify customer exists
  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Customer not found");
  }

  const [[{ value: locationCount }], [{ value: orderCount }]] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(customerLocations)
        .where(and(eq(customerLocations.customerId, customerId), eq(customerLocations.organizationId, ctx.organizationId))),
      db
        .select({ value: count() })
        .from(orders)
        .where(and(eq(orders.customerId, customerId), eq(orders.organizationId, ctx.organizationId))),
    ]);

  if (Number(orderCount) > 0) {
    // Orders have no cancellation state, so the copy can only offer the two
    // actions that exist: reassign the order, or keep the customer (#774).
    throw new SafeError(
      "Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer."
    );
  }

  if (Number(locationCount) > 0) {
    throw new SafeError(
      "Customer was not deleted because it still has locations. Edit the customer and remove its locations first."
    );
  }

  await db.delete(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)));
}

// ============================================
// Customer Location Operations
// ============================================

/**
 * Create a new customer location on an existing customer.
 */
export async function createCustomerLocation(
  ctx: OrgContext,
  data: CustomerLocationInsertInput & { customerId: string }
): Promise<CustomerLocation> {
  requireOrgScope(ctx);

  const { customerId, ...location } = data;
  return db.transaction((tx) =>
    createCustomerLocationInTransaction(ctx, tx, customerId, location)
  );
}

/**
 * Update a customer location
 */
export async function updateCustomerLocation(
  ctx: OrgContext,
  locationId: string,
  data: {
    name?: string;
    country?: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    address?: string | null;
    distanceFromFacilityKm?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    defaultSoilTemperatureC?: number | null;
    isDefault?: boolean;
  }
): Promise<CustomerLocation> {
  requireOrgScope(ctx);

  // Verify location exists
  const [existing] = await db
    .select({ id: customerLocations.id, customerId: customerLocations.customerId })
    .from(customerLocations)
    .where(and(eq(customerLocations.id, locationId), eq(customerLocations.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Customer location not found");
  }

  const updateData: {
    name?: string;
    country?: string;
    stateRegion?: string | null;
    city?: string | null;
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    address?: string | null;
    distanceFromFacilityKm?: number | null;
    distanceSource?: "map_estimate" | "manual" | "document" | null;
    defaultSoilTemperatureC?: number | null;
    isDefault?: boolean;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.country !== undefined) updateData.country = data.country;
  if (data.stateRegion !== undefined) updateData.stateRegion = data.stateRegion;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.gpsLatitude !== undefined) updateData.gpsLatitude = data.gpsLatitude;
  if (data.gpsLongitude !== undefined) updateData.gpsLongitude = data.gpsLongitude;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.distanceFromFacilityKm !== undefined) updateData.distanceFromFacilityKm = data.distanceFromFacilityKm;
  if (data.distanceSource !== undefined) updateData.distanceSource = data.distanceSource;
  if (data.defaultSoilTemperatureC !== undefined) updateData.defaultSoilTemperatureC = data.defaultSoilTemperatureC;
  if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

  return db.transaction(async (tx) => {
    const routeAnchorCanChange =
      data.name !== undefined ||
      data.gpsLatitude !== undefined ||
      data.gpsLongitude !== undefined ||
      data.distanceFromFacilityKm !== undefined ||
      data.distanceSource !== undefined;
    if (routeAnchorCanChange) {
      await lockBiocharTransportRouteTopology(ctx, tx);
    }

    // Promoting this location to default demotes the customer's current default.
    if (data.isDefault === true) {
      await tx
        .update(customerLocations)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(customerLocations.customerId, existing.customerId),
            eq(customerLocations.organizationId, ctx.organizationId),
            eq(customerLocations.isDefault, true)
          )
        );
    }

    const [updated] = await tx
      .update(customerLocations)
      .set(updateData)
      .where(and(eq(customerLocations.id, locationId), eq(customerLocations.organizationId, ctx.organizationId)))
      .returning();

    await syncBiocharLegsForCustomerLocation(ctx, tx, locationId);

    return updated;
  });
  await processPendingStorageObjectDeletions(ctx);
}

/**
 * Delete a customer location
 */
export async function deleteCustomerLocation(
  ctx: OrgContext,
  locationId: string
): Promise<void> {
  requireOrgScope(ctx);

  // Verify location exists
  const [existing] = await db
    .select({ id: customerLocations.id })
    .from(customerLocations)
    .where(and(eq(customerLocations.id, locationId), eq(customerLocations.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Customer location not found");
  }

  await db.delete(customerLocations).where(and(eq(customerLocations.id, locationId), eq(customerLocations.organizationId, ctx.organizationId)));
}

// ============================================
// Utility Operations
// ============================================
