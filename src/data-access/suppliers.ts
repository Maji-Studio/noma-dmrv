/**
 * Suppliers Data Access Layer
 * CRUD operations for suppliers with auth guards, pagination, and filtering
 */

import { isNull, isNotNull, and, asc, desc, eq, ilike, inArray, or, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  suppliers,
  supplierLocations,
  type Supplier,
  type SupplierLocation,
} from "@/db/schema";
import type { SupplierFilterData } from "@/schemas/suppliers";
import { formatSupplierLocationDisplay } from "@/lib/supplier-location-display";
import {
  findSupplierLocations,
  findSupplierRow,
  SUPPLIER_LOCATION_ORDER,
} from "./supplier-detail";


// ============================================
// Types
// ============================================

export type SupplierWithRelations = Supplier & {
  /** Default (or first) structured source-location label for list display. */
  defaultLocationDisplay?: string | null;
};

export interface PaginatedSuppliers {
  items: SupplierWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================
// Auth Guards
// ============================================

import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";

// Supplier records are organization-owned. `suppliers.userId` is retained for
// create-time attribution.
async function ensureSupplierExists(
  ctx: OrgContext,
  supplierId: string
): Promise<{ id: string }> {
  requireOrgScope(ctx);

  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organizationId, ctx.organizationId),
      ),
    );

  if (!supplier) {
    throw new SafeError("Supplier not found");
  }

  return { id: supplier.id };
}

// ============================================
// Supplier Read Operations
// ============================================

/**
 * Get all suppliers with pagination and filtering
 * Supports search, location filter, sorting, and pagination
 */
export async function getSuppliers(
  ctx: OrgContext,
  filters?: Partial<SupplierFilterData>
): Promise<PaginatedSuppliers> {
  requireOrgScope(ctx);

  const {
    search,
    archived = false,
    location,
    page = 1,
    pageSize = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters ?? {};

  const conditions: SQL[] = [
    eq(suppliers.organizationId, ctx.organizationId),
    archived ? isNotNull(suppliers.archivedAt) : isNull(suppliers.archivedAt),
  ];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(suppliers.code, searchPattern),
        ilike(suppliers.name, searchPattern),
        ilike(suppliers.location, searchPattern),
        ilike(suppliers.contactName, searchPattern)
      )!
    );
  }

  if (location) {
    conditions.push(ilike(suppliers.location, location));
  }

  const whereClause = and(...conditions);

  // Build sort clause
  const sortColumn = {
    code: suppliers.code,
    name: suppliers.name,
    location: suppliers.location,
    createdAt: suppliers.createdAt,
    updatedAt: suppliers.updatedAt,
  }[sortBy] ?? suppliers.name;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination
  // org-scope-ok: whereClause includes the active organization predicate.
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(suppliers)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get suppliers
  const supplierList = await db
    .select({
      id: suppliers.id,
      organizationId: suppliers.organizationId,
      userId: suppliers.userId,
      code: suppliers.code,
      name: suppliers.name,
      location: suppliers.location,
      address: suppliers.address,
      contactName: suppliers.contactName,
      contactEmail: suppliers.contactEmail,
      contactPhone: suppliers.contactPhone,
      sourceRegion: suppliers.sourceRegion,
      createdAt: suppliers.createdAt,
      version: suppliers.version,
      updatedAt: suppliers.updatedAt,
      archivedAt: suppliers.archivedAt,
    })
    .from(suppliers)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  const locationRows =
    supplierList.length === 0
      ? []
      : await db
          .select({
            supplierId: supplierLocations.supplierId,
            name: supplierLocations.name,
            city: supplierLocations.city,
            stateRegion: supplierLocations.stateRegion,
            country: supplierLocations.country,
            isDefault: supplierLocations.isDefault,
          })
          .from(supplierLocations)
          .where(
            and(
              inArray(
                supplierLocations.supplierId,
                supplierList.map((supplier) => supplier.id),
              ),
              eq(supplierLocations.organizationId, ctx.organizationId),
            ),
          )
          .orderBy(...SUPPLIER_LOCATION_ORDER);

  const defaultLocationBySupplier = new Map<string, string | null>();
  for (const locationRow of locationRows) {
    if (defaultLocationBySupplier.has(locationRow.supplierId)) continue;
    defaultLocationBySupplier.set(
      locationRow.supplierId,
      formatSupplierLocationDisplay(locationRow),
    );
  }

  const items: SupplierWithRelations[] = supplierList.map((s) => ({
    ...s,
    defaultLocationDisplay: defaultLocationBySupplier.get(s.id) ?? null,
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
 * Get a single supplier by ID
 * Returns supplier data without relations
 */
export async function getSupplierById(
  ctx: OrgContext,
  supplierId: string
): Promise<Supplier> {
  requireOrgScope(ctx);
  await ensureSupplierExists(ctx, supplierId);

  const supplier = await findSupplierRow(ctx, supplierId);

  if (!supplier) {
    throw new SafeError("Supplier not found");
  }

  return supplier;
}

export async function getSupplierLocationsBySupplier(
  ctx: OrgContext,
  supplierId: string
): Promise<SupplierLocation[]> {
  requireOrgScope(ctx);
  await ensureSupplierExists(ctx, supplierId);

  return findSupplierLocations(ctx, supplierId);
}
