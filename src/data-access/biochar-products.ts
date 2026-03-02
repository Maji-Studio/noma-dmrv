/**
 * Biochar Products Data Access Layer
 * CRUD operations for biochar products with auth guards, pagination, filtering, and relations
 */

import { and, asc, desc, eq, ilike, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  formulations,
  facilities,
  storageLocations,
  productionRuns,
  orders,
  deliveries,
  type BiocharProduct,
} from "@/db/schema";
import type { BiocharProductFilterData } from "@/schemas/biochar-products";

// ============================================
// Types
// ============================================

export interface BiocharProductWithRelations extends BiocharProduct {
  facility: {
    id: string;
    code: string;
    name: string;
  };
  formulation: {
    id: string;
    code: string;
    name: string;
  };
  linkedProductionRun?: {
    id: string;
    code: string;
  } | null;
  storageLocation?: {
    id: string;
    code: string;
    name: string;
  } | null;
}

export interface PaginatedBiocharProducts {
  items: BiocharProductWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================
// Auth Guards
// ============================================

/**
 * Require user to be authenticated
 * Throws error if userId is not provided
 */
function requireAuth(userId: string): void {
  if (!userId) {
    throw new Error("Unauthorized");
  }
}

// ============================================
// Biochar Product Read Operations
// ============================================

/**
 * Get all biochar products with pagination, filtering, and relations
 * Supports search, status filter, facility filter, sorting, and pagination
 */
export async function getBiocharProducts(
  userId: string,
  filters?: Partial<BiocharProductFilterData>
): Promise<PaginatedBiocharProducts> {
  requireAuth(userId);

  const {
    search,
    status,
    facilityId,
    formulationId,
    page = 1,
    pageSize = 20,
    sortBy = "productionDate",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions
  const conditions: SQL[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(biocharProducts.code, searchPattern),
        ilike(facilities.name, searchPattern),
        ilike(formulations.name, searchPattern)
      )!
    );
  }

  if (status) {
    conditions.push(eq(biocharProducts.status, status));
  }

  if (facilityId) {
    conditions.push(eq(biocharProducts.facilityId, facilityId));
  }

  if (formulationId) {
    conditions.push(eq(biocharProducts.formulationId, formulationId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Build sort clause
  const sortColumn = {
    code: biocharProducts.code,
    productionDate: biocharProducts.productionDate,
    status: biocharProducts.status,
    massKg: biocharProducts.massKg,
    createdAt: biocharProducts.createdAt,
    updatedAt: biocharProducts.updatedAt,
  }[sortBy] ?? biocharProducts.productionDate;

  const orderFn = sortOrder === "desc" ? desc : asc;

  // Count total for pagination (with joins)
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(biocharProducts)
    .leftJoin(facilities, eq(biocharProducts.facilityId, facilities.id))
    .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get biochar products with relations
  const productList = await db
    .select({
      // Product fields
      id: biocharProducts.id,
      code: biocharProducts.code,
      facilityId: biocharProducts.facilityId,
      productionDate: biocharProducts.productionDate,
      status: biocharProducts.status,
      formulationId: biocharProducts.formulationId,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
      composition: biocharProducts.composition,
      massKg: biocharProducts.massKg,
      densityKgM3: biocharProducts.densityKgM3,
      storageLocationId: biocharProducts.storageLocationId,
      createdAt: biocharProducts.createdAt,
      updatedAt: biocharProducts.updatedAt,
      // Facility relation
      facilityCode: facilities.code,
      facilityName: facilities.name,
      // Formulation relation
      formulationCode: formulations.code,
      formulationName: formulations.name,
      // Storage location relation
      storageLocationCode: storageLocations.code,
      storageLocationName: storageLocations.name,
      // Production run relation
      productionRunCode: productionRuns.code,
    })
    .from(biocharProducts)
    .leftJoin(facilities, eq(biocharProducts.facilityId, facilities.id))
    .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
    .leftJoin(storageLocations, eq(biocharProducts.storageLocationId, storageLocations.id))
    .leftJoin(productionRuns, eq(biocharProducts.linkedProductionRunId, productionRuns.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Transform to BiocharProductWithRelations
  const items: BiocharProductWithRelations[] = productList.map((row) => ({
    id: row.id,
    code: row.code,
    facilityId: row.facilityId,
    productionDate: row.productionDate,
    status: row.status,
    formulationId: row.formulationId,
    linkedProductionRunId: row.linkedProductionRunId,
    composition: row.composition,
    massKg: row.massKg,
    densityKgM3: row.densityKgM3,
    storageLocationId: row.storageLocationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    facility: {
      id: row.facilityId,
      code: row.facilityCode ?? "",
      name: row.facilityName ?? "",
    },
    formulation: {
      id: row.formulationId,
      code: row.formulationCode ?? "",
      name: row.formulationName ?? "",
    },
    linkedProductionRun: row.linkedProductionRunId && row.productionRunCode
      ? {
          id: row.linkedProductionRunId,
          code: row.productionRunCode,
        }
      : null,
    storageLocation: row.storageLocationId && row.storageLocationCode
      ? {
          id: row.storageLocationId,
          code: row.storageLocationCode,
          name: row.storageLocationName ?? "",
        }
      : null,
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
 * Get a single biochar product by ID with relations
 */
export async function getBiocharProductById(
  userId: string,
  productId: string
): Promise<BiocharProductWithRelations> {
  requireAuth(userId);

  const [row] = await db
    .select({
      id: biocharProducts.id,
      code: biocharProducts.code,
      facilityId: biocharProducts.facilityId,
      productionDate: biocharProducts.productionDate,
      status: biocharProducts.status,
      formulationId: biocharProducts.formulationId,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
      composition: biocharProducts.composition,
      massKg: biocharProducts.massKg,
      densityKgM3: biocharProducts.densityKgM3,
      storageLocationId: biocharProducts.storageLocationId,
      createdAt: biocharProducts.createdAt,
      updatedAt: biocharProducts.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      formulationCode: formulations.code,
      formulationName: formulations.name,
      storageLocationCode: storageLocations.code,
      storageLocationName: storageLocations.name,
      productionRunCode: productionRuns.code,
    })
    .from(biocharProducts)
    .leftJoin(facilities, eq(biocharProducts.facilityId, facilities.id))
    .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
    .leftJoin(storageLocations, eq(biocharProducts.storageLocationId, storageLocations.id))
    .leftJoin(productionRuns, eq(biocharProducts.linkedProductionRunId, productionRuns.id))
    .where(eq(biocharProducts.id, productId));

  if (!row) {
    throw new Error("Biochar product not found");
  }

  return {
    id: row.id,
    code: row.code,
    facilityId: row.facilityId,
    productionDate: row.productionDate,
    status: row.status,
    formulationId: row.formulationId,
    linkedProductionRunId: row.linkedProductionRunId,
    composition: row.composition,
    massKg: row.massKg,
    densityKgM3: row.densityKgM3,
    storageLocationId: row.storageLocationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    facility: {
      id: row.facilityId,
      code: row.facilityCode ?? "",
      name: row.facilityName ?? "",
    },
    formulation: {
      id: row.formulationId,
      code: row.formulationCode ?? "",
      name: row.formulationName ?? "",
    },
    linkedProductionRun: row.linkedProductionRunId && row.productionRunCode
      ? {
          id: row.linkedProductionRunId,
          code: row.productionRunCode,
        }
      : null,
    storageLocation: row.storageLocationId && row.storageLocationCode
      ? {
          id: row.storageLocationId,
          code: row.storageLocationCode,
          name: row.storageLocationName ?? "",
        }
      : null,
  };
}

// ============================================
// Biochar Product Create Operations
// ============================================

/**
 * Create a new biochar product
 */
export async function createBiocharProduct(
  userId: string,
  data: {
    code: string;
    facilityId: string;
    formulationId: string;
    productionDate?: Date;
    status?: "draft" | "testing" | "ready" | "sold";
    linkedProductionRunId?: string | null;
    storageLocationId?: string | null;
    massKg?: number | null;
    densityKgM3?: number | null;
    composition?: Record<string, unknown>;
  }
): Promise<BiocharProduct> {
  requireAuth(userId);

  // Check for duplicate code
  const [existing] = await db
    .select({ id: biocharProducts.id })
    .from(biocharProducts)
    .where(eq(biocharProducts.code, data.code));

  if (existing) {
    throw new Error("A biochar product with this code already exists");
  }

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.id, data.facilityId));

  if (!facility) {
    throw new Error("Facility not found");
  }

  // Verify formulation exists
  const [formulation] = await db
    .select({ id: formulations.id })
    .from(formulations)
    .where(eq(formulations.id, data.formulationId));

  if (!formulation) {
    throw new Error("Formulation not found");
  }

  const [product] = await db
    .insert(biocharProducts)
    .values({
      code: data.code,
      facilityId: data.facilityId,
      formulationId: data.formulationId,
      productionDate: data.productionDate ?? new Date(),
      status: data.status ?? "testing",
      linkedProductionRunId: data.linkedProductionRunId ?? null,
      storageLocationId: data.storageLocationId ?? null,
      massKg: data.massKg ?? null,
      densityKgM3: data.densityKgM3 ?? null,
      composition: data.composition ?? {},
    })
    .returning();

  return product;
}

// ============================================
// Biochar Product Update Operations
// ============================================

/**
 * Update an existing biochar product
 */
export async function updateBiocharProduct(
  userId: string,
  productId: string,
  data: {
    code?: string;
    facilityId?: string;
    formulationId?: string;
    productionDate?: Date;
    status?: "draft" | "testing" | "ready" | "sold";
    linkedProductionRunId?: string | null;
    storageLocationId?: string | null;
    massKg?: number | null;
    densityKgM3?: number | null;
    composition?: Record<string, unknown>;
  }
): Promise<BiocharProduct> {
  requireAuth(userId);

  // Verify product exists
  const [existing] = await db
    .select()
    .from(biocharProducts)
    .where(eq(biocharProducts.id, productId));

  if (!existing) {
    throw new Error("Biochar product not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: biocharProducts.id })
      .from(biocharProducts)
      .where(eq(biocharProducts.code, data.code));

    if (duplicate) {
      throw new Error("A biochar product with this code already exists");
    }
  }

  // Verify facility if being changed
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.id, data.facilityId));

    if (!facility) {
      throw new Error("Facility not found");
    }
  }

  // Verify formulation if being changed
  if (data.formulationId && data.formulationId !== existing.formulationId) {
    const [formulation] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(eq(formulations.id, data.formulationId));

    if (!formulation) {
      throw new Error("Formulation not found");
    }
  }

  const [updated] = await db
    .update(biocharProducts)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(biocharProducts.id, productId))
    .returning();

  return updated;
}

// ============================================
// Biochar Product Delete Operations
// ============================================

/**
 * Delete a biochar product
 */
export async function deleteBiocharProduct(
  userId: string,
  productId: string
): Promise<void> {
  requireAuth(userId);

  // Verify product exists
  const [existing] = await db
    .select({ id: biocharProducts.id })
    .from(biocharProducts)
    .where(eq(biocharProducts.id, productId));

  if (!existing) {
    throw new Error("Biochar product not found");
  }

  // Check for associated orders
  const [orderCount] = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.biocharProductId, productId));

  if (Number(orderCount.count) > 0) {
    throw new Error(
      "Cannot delete biochar product with associated orders. Remove orders first."
    );
  }

  // Check for associated deliveries
  const [deliveryCount] = await db
    .select({ count: count() })
    .from(deliveries)
    .where(eq(deliveries.biocharProductId, productId));

  if (Number(deliveryCount.count) > 0) {
    throw new Error(
      "Cannot delete biochar product with associated deliveries. Remove deliveries first."
    );
  }

  await db.delete(biocharProducts).where(eq(biocharProducts.id, productId));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a biochar product code is available
 */
export async function isBiocharProductCodeAvailable(
  userId: string,
  code: string,
  excludeProductId?: string
): Promise<boolean> {
  requireAuth(userId);

  const conditions: SQL[] = [eq(biocharProducts.code, code)];

  if (excludeProductId) {
    conditions.push(sql`${biocharProducts.id} != ${excludeProductId}`);
  }

  const [existing] = await db
    .select({ id: biocharProducts.id })
    .from(biocharProducts)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get biochar product options for dropdowns
 * Returns minimal data needed for select inputs
 */
export async function getBiocharProductOptions(
  userId: string
): Promise<Array<{ id: string; code: string }>> {
  requireAuth(userId);

  return db
    .select({
      id: biocharProducts.id,
      code: biocharProducts.code,
    })
    .from(biocharProducts)
    .orderBy(desc(biocharProducts.productionDate));
}
