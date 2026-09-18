import { lockBinStocks } from './lock-bin-stocks';
/**
 * Biochar Products Data Access Layer
 * CRUD operations for biochar products with auth guards, pagination, filtering, and relations
 */

import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  facilities,
  formulations,
  productionRuns,
  storageLocations,
  type BiocharProduct
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { BiocharProductFilterData } from "@/schemas/biochar-products";
import { and, asc, count, desc, eq, ilike, isNull, or, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { inCreditBatchLineage } from "./credit-batch-lineage-filter";

const sourceBiocharStorageLocations = alias(
  storageLocations,
  "source_biochar_storage_locations",
);
const linkedRunBiocharStorageLocations = alias(
  storageLocations,
  "linked_run_biochar_storage_locations",
);

// ============================================
// Types
// ============================================
export interface BiocharProductWithRelations extends BiocharProduct {
  /** Immutable dry mass drawn from the source bin when this product was created. */
  sourceAllocatedDryMassKg: number | null;
  facility: {
    id: string;
    code: string;
    name: string;
  };
  /** Null for a pure-biochar product (no amendment blend). */
  formulation: {
    id: string;
    code: string;
    name: string;
  } | null;
  linkedProductionRun?: {
    id: string;
    code: string;
    biocharStorageLocationId: string | null;
    biocharStorageLocationName: string | null;
  } | null;
  sourceBiocharStorageLocation?: {
    id: string;
    code: string;
    name: string;
  } | null;
  storageLocation?: {
    id: string;
    code: string;
    name: string;
  } | null;
}

function sourceAllocationAggregate(ctx: OrgContext) {
  return db
    .select({
      biocharProductId: biocharProductSourceAllocations.biocharProductId,
      allocatedDryMassKg: sumNumeric(
        biocharProductSourceAllocations.allocatedDryMassKg,
      ).as("allocated_dry_mass_kg"),
    })
    .from(biocharProductSourceAllocations)
    .where(
      eq(
        biocharProductSourceAllocations.organizationId,
        ctx.organizationId,
      ),
    )
    .groupBy(biocharProductSourceAllocations.biocharProductId)
    .as("biochar_product_source_allocation_aggregate");
}

export interface PaginatedBiocharProducts {
  items: BiocharProductWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
// ============================================
// Helpers
// ============================================
// ============================================
// Auth Guards
// ============================================

import { SafeError } from "@/lib/errors";
import {
  compositionAllocationChanged
} from "./biochar-product-composition";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

// ============================================
// Biochar Product Read Operations
// ============================================

/**
 * Get all biochar products with pagination, filtering, and relations
 * Supports search, status filter, facility filter, sorting, and pagination
 */
export async function getBiocharProducts(
  ctx: OrgContext,
  filters?: Partial<BiocharProductFilterData>
): Promise<PaginatedBiocharProducts> {
  requireOrgScope(ctx);
  const allocationAggregate = sourceAllocationAggregate(ctx);

  const {
    search,
    status,
    facilityId,
    creditBatchId,
    formulationId,
    page = 1,
    pageSize = 20,
    sortBy = "productionDate",
    sortOrder = "desc",
  } = filters ?? {};

  // Build where conditions — archived products (facility archive cascade) are hidden
  const conditions: SQL[] = [eq(biocharProducts.organizationId, ctx.organizationId), isNull(biocharProducts.archivedAt)];

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

  if (creditBatchId) {
    conditions.push(
      inCreditBatchLineage(ctx, creditBatchId, biocharProducts.id),
    );
  }

  if (formulationId) {
    conditions.push(eq(biocharProducts.formulationId, formulationId));
  }

  const whereClause = and(...conditions);

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
    .leftJoin(facilities, and(eq(biocharProducts.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get biochar products with relations
  const productList = await db
    .select({
      // Product fields
      id: biocharProducts.id,
      organizationId: biocharProducts.organizationId,
      code: biocharProducts.code,
      facilityId: biocharProducts.facilityId,
      productionDate: biocharProducts.productionDate,
      placedAt: biocharProducts.placedAt,
      stockPostingSequence: biocharProducts.stockPostingSequence,
      status: biocharProducts.status,
      formulationId: biocharProducts.formulationId,
      biocharRatio: biocharProducts.biocharRatio,
      sourceBiocharStorageLocationId:
        biocharProducts.sourceBiocharStorageLocationId,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
      composition: biocharProducts.composition,
      massKg: biocharProducts.massKg,
      moistureContentPercent: biocharProducts.moistureContentPercent,
      densityKgM3: biocharProducts.densityKgM3,
      waterAddedKg: biocharProducts.waterAddedKg,
      storageLocationId: biocharProducts.storageLocationId,
      expiresAt: biocharProducts.expiresAt,
      archivedAt: biocharProducts.archivedAt,
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
      sourceBiocharStorageLocationCode:
        sourceBiocharStorageLocations.code,
      sourceBiocharStorageLocationName:
        sourceBiocharStorageLocations.name,
      // Production run relation
      productionRunCode: productionRuns.code,
      linkedRunBiocharStorageLocationId:
        productionRuns.biocharStorageLocationId,
      linkedRunBiocharStorageLocationName:
        linkedRunBiocharStorageLocations.name,
      sourceAllocatedDryMassKg: allocationAggregate.allocatedDryMassKg,
    })
    .from(biocharProducts)
    .leftJoin(facilities, and(eq(biocharProducts.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(biocharProducts.storageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)))
    .leftJoin(
      sourceBiocharStorageLocations,
      and(
        eq(
          biocharProducts.sourceBiocharStorageLocationId,
          sourceBiocharStorageLocations.id,
        ),
        eq(
          sourceBiocharStorageLocations.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .leftJoin(productionRuns, and(eq(biocharProducts.linkedProductionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(
      linkedRunBiocharStorageLocations,
      and(
        eq(
          productionRuns.biocharStorageLocationId,
          linkedRunBiocharStorageLocations.id,
        ),
        eq(
          linkedRunBiocharStorageLocations.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .leftJoin(
      allocationAggregate,
      eq(allocationAggregate.biocharProductId, biocharProducts.id),
    )
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Transform to BiocharProductWithRelations
  const items: BiocharProductWithRelations[] = productList.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    facilityId: row.facilityId,
    productionDate: row.productionDate,
    placedAt: row.placedAt,
    stockPostingSequence: row.stockPostingSequence,
    status: row.status,
    formulationId: row.formulationId,
    biocharRatio: row.biocharRatio,
    sourceBiocharStorageLocationId:
      row.sourceBiocharStorageLocationId,
    sourceAllocatedDryMassKg: row.sourceAllocatedDryMassKg,
    linkedProductionRunId: row.linkedProductionRunId,
    composition: row.composition,
    massKg: row.massKg,
    moistureContentPercent: row.moistureContentPercent,
    densityKgM3: row.densityKgM3,
    waterAddedKg: row.waterAddedKg,
    storageLocationId: row.storageLocationId,
    expiresAt: row.expiresAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    facility: {
      id: row.facilityId,
      code: row.facilityCode ?? "",
      name: row.facilityName ?? "",
    },
    formulation: row.formulationId
      ? {
          id: row.formulationId,
          code: row.formulationCode ?? "",
          name: row.formulationName ?? "",
        }
      : null,
    linkedProductionRun: row.linkedProductionRunId && row.productionRunCode
      ? {
          id: row.linkedProductionRunId,
          code: row.productionRunCode,
          biocharStorageLocationId:
            row.linkedRunBiocharStorageLocationId,
          biocharStorageLocationName:
            row.linkedRunBiocharStorageLocationName ?? null,
        }
      : null,
    sourceBiocharStorageLocation:
      row.sourceBiocharStorageLocationId &&
      row.sourceBiocharStorageLocationCode
        ? {
            id: row.sourceBiocharStorageLocationId,
            code: row.sourceBiocharStorageLocationCode,
            name: row.sourceBiocharStorageLocationName ?? "",
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
  ctx: OrgContext,
  productId: string
): Promise<BiocharProductWithRelations> {
  requireOrgScope(ctx);
  const allocationAggregate = sourceAllocationAggregate(ctx);

  const [row] = await db
    .select({
      id: biocharProducts.id,
      organizationId: biocharProducts.organizationId,
      code: biocharProducts.code,
      facilityId: biocharProducts.facilityId,
      productionDate: biocharProducts.productionDate,
      placedAt: biocharProducts.placedAt,
      stockPostingSequence: biocharProducts.stockPostingSequence,
      status: biocharProducts.status,
      formulationId: biocharProducts.formulationId,
      biocharRatio: biocharProducts.biocharRatio,
      sourceBiocharStorageLocationId:
        biocharProducts.sourceBiocharStorageLocationId,
      linkedProductionRunId: biocharProducts.linkedProductionRunId,
      composition: biocharProducts.composition,
      massKg: biocharProducts.massKg,
      moistureContentPercent: biocharProducts.moistureContentPercent,
      densityKgM3: biocharProducts.densityKgM3,
      waterAddedKg: biocharProducts.waterAddedKg,
      storageLocationId: biocharProducts.storageLocationId,
      expiresAt: biocharProducts.expiresAt,
      archivedAt: biocharProducts.archivedAt,
      createdAt: biocharProducts.createdAt,
      updatedAt: biocharProducts.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      formulationCode: formulations.code,
      formulationName: formulations.name,
      storageLocationCode: storageLocations.code,
      storageLocationName: storageLocations.name,
      sourceBiocharStorageLocationCode:
        sourceBiocharStorageLocations.code,
      sourceBiocharStorageLocationName:
        sourceBiocharStorageLocations.name,
      productionRunCode: productionRuns.code,
      linkedRunBiocharStorageLocationId:
        productionRuns.biocharStorageLocationId,
      linkedRunBiocharStorageLocationName:
        linkedRunBiocharStorageLocations.name,
      sourceAllocatedDryMassKg: allocationAggregate.allocatedDryMassKg,
    })
    .from(biocharProducts)
    .leftJoin(facilities, and(eq(biocharProducts.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(biocharProducts.storageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)))
    .leftJoin(
      sourceBiocharStorageLocations,
      and(
        eq(
          biocharProducts.sourceBiocharStorageLocationId,
          sourceBiocharStorageLocations.id,
        ),
        eq(
          sourceBiocharStorageLocations.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .leftJoin(productionRuns, and(eq(biocharProducts.linkedProductionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
    .leftJoin(
      linkedRunBiocharStorageLocations,
      and(
        eq(
          productionRuns.biocharStorageLocationId,
          linkedRunBiocharStorageLocations.id,
        ),
        eq(
          linkedRunBiocharStorageLocations.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .leftJoin(
      allocationAggregate,
      eq(allocationAggregate.biocharProductId, biocharProducts.id),
    )
    .where(and(eq(biocharProducts.id, productId), eq(biocharProducts.organizationId, ctx.organizationId)));

  if (!row) {
    throw new SafeError("Biochar product not found");
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    facilityId: row.facilityId,
    productionDate: row.productionDate,
    placedAt: row.placedAt,
    stockPostingSequence: row.stockPostingSequence,
    status: row.status,
    formulationId: row.formulationId,
    biocharRatio: row.biocharRatio,
    sourceBiocharStorageLocationId:
      row.sourceBiocharStorageLocationId,
    sourceAllocatedDryMassKg: row.sourceAllocatedDryMassKg,
    linkedProductionRunId: row.linkedProductionRunId,
    composition: row.composition,
    massKg: row.massKg,
    moistureContentPercent: row.moistureContentPercent,
    densityKgM3: row.densityKgM3,
    waterAddedKg: row.waterAddedKg,
    storageLocationId: row.storageLocationId,
    expiresAt: row.expiresAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    facility: {
      id: row.facilityId,
      code: row.facilityCode ?? "",
      name: row.facilityName ?? "",
    },
    formulation: row.formulationId
      ? {
          id: row.formulationId,
          code: row.formulationCode ?? "",
          name: row.formulationName ?? "",
        }
      : null,
    linkedProductionRun: row.linkedProductionRunId && row.productionRunCode
      ? {
          id: row.linkedProductionRunId,
          code: row.productionRunCode,
          biocharStorageLocationId:
            row.linkedRunBiocharStorageLocationId,
          biocharStorageLocationName:
            row.linkedRunBiocharStorageLocationName ?? null,
        }
      : null,
    sourceBiocharStorageLocation:
      row.sourceBiocharStorageLocationId &&
      row.sourceBiocharStorageLocationCode
        ? {
            id: row.sourceBiocharStorageLocationId,
            code: row.sourceBiocharStorageLocationCode,
            name: row.sourceBiocharStorageLocationName ?? "",
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

export { createBiocharProduct } from "./biochar-product-create";

// ============================================
// Biochar Product Update Operations
// ============================================

/**
 * Update an existing biochar product
 */
export async function updateBiocharProduct(ctx: OrgContext, productId: string, data: {
  code?: string; facilityId?: string; formulationId?: string | null; placedAt?: string;
  status?: 'draft' | 'testing' | 'ready' | 'sold'; linkedProductionRunId?: string | null;
  storageLocationId?: string | null; massKg?: number | null; moistureContentPercent?: number | null;
  densityKgM3?: number | null; waterAddedKg?: number | null; composition?: Record<string, unknown>;
}): Promise<BiocharProduct> {
  requireOrgScope(ctx);
  return db.transaction(async tx => {
    const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId)));
    if (!product) throw new SafeError('Biochar product not found');
    await lockBinStocks(ctx, tx, [product.storageLocationId, product.sourceBiocharStorageLocationId]);
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'biocharProduct', entityId: productId }, 'update');
    for (const key of ['facilityId', 'formulationId', 'placedAt', 'linkedProductionRunId', 'storageLocationId', 'massKg', 'moistureContentPercent', 'waterAddedKg'] as const) {
      if (data[key] !== undefined && data[key] !== product[key]) throw new SafeError('Posted product source, composition, placement, and bin are immutable. Use an explicit stock correction.');
    }
    if (data.composition && compositionAllocationChanged(product.composition as Record<string, unknown>, data.composition)) throw new SafeError('Posted ingredient moisture and dry solids are immutable.');
    const [saved] = await tx.update(biocharProducts).set({ code: data.code, status: data.status, densityKgM3: data.densityKgM3, updatedAt: new Date() }).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId))).returning();
    return saved;
  });
}
export async function deleteBiocharProduct(ctx: OrgContext, productId: string): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(async tx => {
    await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'biocharProduct', entityId: productId }, 'delete');
    const [product] = await tx.select({ id: biocharProducts.id }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId)));
    if (!product) throw new SafeError('Biochar product not found');
    throw new SafeError('Posted products retain their source allocations and history. Use an explicit stock correction.');
  });
}
