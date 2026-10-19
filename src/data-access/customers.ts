import { withLocationFacilityDistances } from "./location-facility-distances";
/**
 * Customers Data Access Layer
 * CRUD operations for customers and customer locations with auth guards, pagination, and filtering
 */

import { isNull, isNotNull, and, asc, desc, eq, ilike, inArray, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  customers,
  customerLocations,
  type Customer,
  type CustomerLocation,
} from "@/db/schema";
import type { CustomerFilterData } from "@/schemas/customers";
import type { FacilityDistance } from "@/schemas/facility-distances";

/** Customer location list order; promotion on delete uses the same order. */
export const CUSTOMER_LOCATION_ORDER = [
  sql`${customerLocations.name} asc nulls last`,
  asc(customerLocations.id),
];

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
import {
  findCustomerWithRelations,
  type CustomerDetail,
} from "./customer-detail";
export type { CustomerDetail } from "./customer-detail";
export type { CustomerLocationInsertInput } from "./customer-create";
export type { CreatedCustomerWithLocations } from "./customer-writes";

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
    archived = false,
    cropType,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [eq(customers.organizationId, ctx.organizationId), archived ? isNotNull(customers.archivedAt) : isNull(customers.archivedAt)];

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
      version: customers.version,
      updatedAt: customers.updatedAt,
      archivedAt: customers.archivedAt,
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
          .where(and(inArray(customerLocations.customerId, customerIds), eq(customerLocations.organizationId, ctx.organizationId), isNull(customerLocations.archivedAt)))
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
    name: string;
    country: string;
    stateRegion: string | null;
    city: string | null;
    gpsLatitude: number;
    gpsLongitude: number;
    address: string | null;
    facilityDistances: FacilityDistance[];
    defaultSoilTemperatureC: number | null;
    isDefault: boolean;
    createdAt: Date;
    version: number;
    updatedAt: Date;
    archivedAt: Date | null;
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

  const locations = await db
    .select({
      id: customerLocations.id,
      name: customerLocations.name,
      country: customerLocations.country,
      stateRegion: customerLocations.stateRegion,
      city: customerLocations.city,
      gpsLatitude: customerLocations.gpsLatitude,
      gpsLongitude: customerLocations.gpsLongitude,
      address: customerLocations.address,
      defaultSoilTemperatureC: customerLocations.defaultSoilTemperatureC,
      isDefault: customerLocations.isDefault,
      createdAt: customerLocations.createdAt,
      version: customerLocations.version,
      updatedAt: customerLocations.updatedAt,
      archivedAt: customerLocations.archivedAt,
    })
    .from(customerLocations)
    .where(and(eq(customerLocations.customerId, customerId), eq(customerLocations.organizationId, ctx.organizationId)))
    .orderBy(...CUSTOMER_LOCATION_ORDER);
  return withLocationFacilityDistances(ctx, "customer", locations);
}
