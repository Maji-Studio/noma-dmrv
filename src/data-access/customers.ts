/**
 * Customers Data Access Layer
 * CRUD operations for customers and customer locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  customerLocations,
  type Customer,
  type CustomerLocation,
} from "@/db/schema";
import type { CustomerFilterData } from "@/schemas/customers";

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

export interface CustomerDetail extends Customer {
  locations: Array<{
    id: string;
    name: string;
    gpsLatitude: number;
    gpsLongitude: number;
    address: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
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

import { requireAuth } from "./utils";

// ============================================
// Customer Read Operations
// ============================================

/**
 * Get all customers with pagination and filtering
 * Supports search, crop type filter, sorting, and pagination
 */
export async function getCustomers(
  userId: string,
  filters?: Partial<CustomerFilterData>
): Promise<PaginatedCustomers> {
  requireAuth(userId);

  const {
    search,
    cropType,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

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
          .where(inArray(customerLocations.customerId, customerIds))
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
  userId: string,
  customerId: string
): Promise<Customer> {
  requireAuth(userId);

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    throw new Error("Customer not found");
  }

  return customer;
}

/**
 * Get a single customer with all its relationships
 * Includes locations
 */
export async function getCustomerWithRelations(
  userId: string,
  customerId: string
): Promise<CustomerDetail> {
  requireAuth(userId);

  // Get customer
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    throw new Error("Customer not found");
  }

  // Get associated locations
  const locations = await db
    .select({
      id: customerLocations.id,
      name: customerLocations.name,
      gpsLatitude: customerLocations.gpsLatitude,
      gpsLongitude: customerLocations.gpsLongitude,
      address: customerLocations.address,
      createdAt: customerLocations.createdAt,
      updatedAt: customerLocations.updatedAt,
    })
    .from(customerLocations)
    .where(eq(customerLocations.customerId, customerId))
    .orderBy(asc(customerLocations.name));

  return {
    ...customer,
    locations,
  };
}

/**
 * Get locations associated with a customer
 */
export async function getCustomerLocations(
  userId: string,
  customerId: string
): Promise<
  Array<{
    id: string;
    name: string;
    gpsLatitude: number;
    gpsLongitude: number;
    address: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
  requireAuth(userId);

  // Verify customer exists
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    throw new Error("Customer not found");
  }

  return db
    .select({
      id: customerLocations.id,
      name: customerLocations.name,
      gpsLatitude: customerLocations.gpsLatitude,
      gpsLongitude: customerLocations.gpsLongitude,
      address: customerLocations.address,
      createdAt: customerLocations.createdAt,
      updatedAt: customerLocations.updatedAt,
    })
    .from(customerLocations)
    .where(eq(customerLocations.customerId, customerId))
    .orderBy(asc(customerLocations.name));
}

// ============================================
// Customer Create Operations
// ============================================

/**
 * Create a new customer
 */
export async function createCustomer(
  userId: string,
  data: {
    code: string;
    name: string;
    cropType?: string | null;
    address?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  }
): Promise<Customer> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.code, data.code));

  if (existing) {
    throw new Error("A customer with this code already exists");
  }

  const [customer] = await db
    .insert(customers)
    .values({
      code: data.code,
      name: data.name,
      cropType: data.cropType ?? null,
      address: data.address ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
    })
    .returning();

  return customer;
}

// ============================================
// Customer Update Operations
// ============================================

/**
 * Update an existing customer
 */
export async function updateCustomer(
  userId: string,
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
  requireAuth(userId);

  // Verify customer exists
  const [existing] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!existing) {
    throw new Error("Customer not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.code, data.code));

    if (duplicate) {
      throw new Error("A customer with this code already exists");
    }
  }

  const [updated] = await db
    .update(customers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId))
    .returning();

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
  userId: string,
  customerId: string
): Promise<void> {
  requireAuth(userId);

  // Verify customer exists
  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!existing) {
    throw new Error("Customer not found");
  }

  // Check for associated locations
  const [locationCount] = await db
    .select({ count: count() })
    .from(customerLocations)
    .where(eq(customerLocations.customerId, customerId));

  if (Number(locationCount.count) > 0) {
    throw new Error(
      "Cannot delete customer with associated locations. Remove locations first."
    );
  }

  await db.delete(customers).where(eq(customers.id, customerId));
}

// ============================================
// Customer Location Operations
// ============================================

/**
 * Get a single customer location by ID
 */
export async function getCustomerLocationById(
  userId: string,
  locationId: string
): Promise<CustomerLocation> {
  requireAuth(userId);

  const [location] = await db
    .select()
    .from(customerLocations)
    .where(eq(customerLocations.id, locationId));

  if (!location) {
    throw new Error("Customer location not found");
  }

  return location;
}

/**
 * Create a new customer location
 */
export async function createCustomerLocation(
  userId: string,
  data: {
    customerId: string;
    name: string;
    gpsLatitude: number;
    gpsLongitude: number;
    address?: string | null;
  }
): Promise<CustomerLocation> {
  requireAuth(userId);

  // Verify customer exists
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, data.customerId));

  if (!customer) {
    throw new Error("Customer not found");
  }

  const [location] = await db
    .insert(customerLocations)
    .values({
      customerId: data.customerId,
      name: data.name,
      gpsLatitude: data.gpsLatitude,
      gpsLongitude: data.gpsLongitude,
      address: data.address ?? null,
    })
    .returning();

  return location;
}

/**
 * Update a customer location
 */
export async function updateCustomerLocation(
  userId: string,
  locationId: string,
  data: {
    name?: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
    address?: string | null;
  }
): Promise<CustomerLocation> {
  requireAuth(userId);

  // Verify location exists
  const [existing] = await db
    .select()
    .from(customerLocations)
    .where(eq(customerLocations.id, locationId));

  if (!existing) {
    throw new Error("Customer location not found");
  }

  const [updated] = await db
    .update(customerLocations)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(customerLocations.id, locationId))
    .returning();

  return updated;
}

/**
 * Delete a customer location
 */
export async function deleteCustomerLocation(
  userId: string,
  locationId: string
): Promise<void> {
  requireAuth(userId);

  // Verify location exists
  const [existing] = await db
    .select({ id: customerLocations.id })
    .from(customerLocations)
    .where(eq(customerLocations.id, locationId));

  if (!existing) {
    throw new Error("Customer location not found");
  }

  await db.delete(customerLocations).where(eq(customerLocations.id, locationId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a customer code is available
 */
export async function isCustomerCodeAvailable(
  userId: string,
  code: string,
  excludeCustomerId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(customers.code, code)];

  if (excludeCustomerId) {
    conditions.push(sql`${customers.id} != ${excludeCustomerId}`);
  }

  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get unique crop types from all customers
 * Useful for filter dropdowns
 */
export async function getCustomerCropTypes(userId: string): Promise<string[]> {
  requireAuth(userId);

  const results = await db
    .selectDistinct({ cropType: customers.cropType })
    .from(customers)
    .where(sql`${customers.cropType} IS NOT NULL AND ${customers.cropType} != ''`)
    .orderBy(asc(customers.cropType));

  return results.map((r) => r.cropType!).filter(Boolean);
}
