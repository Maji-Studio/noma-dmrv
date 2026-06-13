/**
 * Biochar Products Data Access Layer
 * CRUD operations for biochar products with auth guards, pagination, filtering, and relations
 */

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  formulations,
  facilities,
  storageLocations,
  feedstockTypes,
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
  /** Null for a pure-biochar product (no amendment blend). */
  formulation: {
    id: string;
    code: string;
    name: string;
  } | null;
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

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";
import { deleteTransportLegsForEntity } from "./transport-legs";

function getCompositionIngredientBinRefs(
  composition: Record<string, unknown> | null | undefined
): Array<{ storageLocationId: string; feedstockTypeId: string }> {
  const ingredients = composition?.ingredients;
  if (!Array.isArray(ingredients)) return [];

  return ingredients
    .map((ingredient) => {
      if (
        typeof ingredient !== "object" ||
        ingredient === null ||
        !("storageLocationId" in ingredient) ||
        !("feedstockTypeId" in ingredient) ||
        typeof ingredient.storageLocationId !== "string" ||
        typeof ingredient.feedstockTypeId !== "string"
      ) {
        return null;
      }
      return {
        storageLocationId: ingredient.storageLocationId,
        feedstockTypeId: ingredient.feedstockTypeId,
      };
    })
    .filter((ref): ref is { storageLocationId: string; feedstockTypeId: string } =>
      Boolean(ref?.storageLocationId && ref.feedstockTypeId)
    );
}

async function validateCompositionIngredientBins(
  tx: Pick<typeof db, "select">,
  composition: Record<string, unknown> | null | undefined,
  facilityId: string
) {
  const binRefs = getCompositionIngredientBinRefs(composition);
  const storageLocationIds = [...new Set(binRefs.map((ref) => ref.storageLocationId))];
  if (storageLocationIds.length === 0) return;
  const expectedFeedstockTypeByBinId = new Map<string, string>();
  for (const ref of binRefs) {
    const existing = expectedFeedstockTypeByBinId.get(ref.storageLocationId);
    if (existing && existing !== ref.feedstockTypeId) {
      throw new SafeError("Ingredient bin cannot be reused for different formulation materials");
    }
    expectedFeedstockTypeByBinId.set(ref.storageLocationId, ref.feedstockTypeId);
  }

  const bins = await tx
    .select({
      id: storageLocations.id,
      facilityId: storageLocations.facilityId,
      type: storageLocations.type,
      feedstockTypeId: storageLocations.feedstockTypeId,
      feedstockTypeUsage: feedstockTypes.usage,
    })
    .from(storageLocations)
    .leftJoin(feedstockTypes, eq(storageLocations.feedstockTypeId, feedstockTypes.id))
    .where(inArray(storageLocations.id, storageLocationIds));

  if (bins.length !== storageLocationIds.length) {
    throw new SafeError("Ingredient bin not found");
  }

  for (const bin of bins) {
    if (bin.facilityId !== facilityId) {
      throw new SafeError("Ingredient bin belongs to a different facility");
    }
    if (bin.type !== "feedstock_bin") {
      throw new SafeError("Ingredient bin must be a feedstock bin");
    }
    if (!bin.feedstockTypeId || bin.feedstockTypeUsage !== "blend") {
      throw new SafeError("Ingredient bin must hold blend-usage feedstock");
    }
    if (bin.feedstockTypeId !== expectedFeedstockTypeByBinId.get(bin.id)) {
      throw new SafeError("Ingredient bin must match the formulation material");
    }
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

  // Build where conditions — archived products (facility archive cascade) are hidden
  const conditions: SQL[] = [isNull(biocharProducts.archivedAt)];

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
      productionRunCode: productionRuns.code,
    })
    .from(biocharProducts)
    .leftJoin(facilities, eq(biocharProducts.facilityId, facilities.id))
    .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
    .leftJoin(storageLocations, eq(biocharProducts.storageLocationId, storageLocations.id))
    .leftJoin(productionRuns, eq(biocharProducts.linkedProductionRunId, productionRuns.id))
    .where(eq(biocharProducts.id, productId));

  if (!row) {
    throw new SafeError("Biochar product not found");
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
    formulationId?: string | null;
    productionDate?: Date;
    status?: "draft" | "testing" | "ready" | "sold";
    linkedProductionRunId?: string | null;
    storageLocationId?: string | null;
    massKg?: number | null;
    moistureContentPercent?: number | null;
    densityKgM3?: number | null;
    waterAddedKg?: number | null;
    composition?: Record<string, unknown>;
  }
): Promise<BiocharProduct> {
  requireAuth(userId);

  // A null formulation means a pure-biochar product (no amendment blend).
  const formulationId = data.formulationId ?? null;

  // Check for duplicate code
  const [existing] = await db
    .select({ id: biocharProducts.id })
    .from(biocharProducts)
    .where(eq(biocharProducts.code, data.code));

  if (existing) {
    throw new SafeError("A biochar product with this code already exists");
  }

  // Verify facility exists and is active; verify the formulation only when one
  // was provided. The lookups are independent, so run them in parallel — but
  // evaluate the results in a fixed order so the surfaced error stays
  // deterministic (facility before formulation).
  const [[facility], formulationRows] = await Promise.all([
    db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), isNull(facilities.archivedAt))),
    formulationId
      ? db
          .select({ id: formulations.id })
          .from(formulations)
          .where(eq(formulations.id, formulationId))
      : Promise.resolve([] as { id: string }[]),
  ]);

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }

  if (formulationId && formulationRows.length === 0) {
    throw new SafeError("Formulation not found");
  }

  if (!data.linkedProductionRunId) {
    throw new SafeError("Production run is required");
  }

  if (!data.storageLocationId) {
    throw new SafeError("Product bin is required");
  }

  if (data.massKg == null || !Number.isFinite(data.massKg) || data.massKg < 0) {
    throw new SafeError("Wet mass must be a non-negative finite number");
  }

  if (
    data.moistureContentPercent == null ||
    !Number.isFinite(data.moistureContentPercent) ||
    data.moistureContentPercent < 0 ||
    data.moistureContentPercent > 100
  ) {
    throw new SafeError("Moisture content must be between 0 and 100");
  }

  if (data.waterAddedKg == null || !Number.isFinite(data.waterAddedKg) || data.waterAddedKg < 0) {
    throw new SafeError("Water added must be a non-negative finite number");
  }

  // Validate the linked production run (independent, read-only).
  const [run] = await db
    .select({ id: productionRuns.id, facilityId: productionRuns.facilityId })
    .from(productionRuns)
    .where(eq(productionRuns.id, data.linkedProductionRunId));

  if (!run) {
    throw new SafeError("Linked production run not found");
  }
  if (run.facilityId !== data.facilityId) {
    throw new SafeError("Linked production run belongs to a different facility");
  }

  const destinationBinId = data.storageLocationId;

  // Lock the destination bin, validate it, insert the product, and claim the bin
  // atomically. The row lock serializes concurrent placements into the same bin,
  // so two products with different formulations can't both pass the reservation
  // check and strand a mismatched product (the claim-after-insert TOCTOU).
  const product = await db.transaction(async (tx) => {
    await validateCompositionIngredientBins(tx, data.composition, data.facilityId);

    const [storage] = await tx
      .select({
        id: storageLocations.id,
        facilityId: storageLocations.facilityId,
        type: storageLocations.type,
        formulationId: storageLocations.formulationId,
      })
      .from(storageLocations)
      .where(eq(storageLocations.id, destinationBinId))
      .for("update");

    if (!storage) {
      throw new SafeError("Storage location not found");
    }
    if (storage.facilityId !== data.facilityId) {
      throw new SafeError("Storage location belongs to a different facility");
    }
    if (storage.type !== "product_bin") {
      throw new SafeError("Storage location must be a product bin");
    }
    // Keep the bin clean: a product bin holds one formulation (or pure biochar).
    // An unassigned bin (null) accepts anything and is claimed below on first use.
    if (storage.formulationId !== null && storage.formulationId !== formulationId) {
      throw new SafeError(
        "Product bin is reserved for a different formulation. Pick a matching or empty bin."
      );
    }

    const [inserted] = await tx
      .insert(biocharProducts)
      .values({
        code: data.code,
        facilityId: data.facilityId,
        formulationId,
        productionDate: data.productionDate ?? new Date(),
        status: data.status ?? "testing",
        linkedProductionRunId: data.linkedProductionRunId ?? null,
        storageLocationId: destinationBinId,
        massKg: data.massKg ?? null,
        moistureContentPercent: data.moistureContentPercent ?? null,
        densityKgM3: data.densityKgM3 ?? null,
        waterAddedKg: data.waterAddedKg ?? null,
        composition: data.composition ?? {},
      })
      .returning();

    // Claim an unassigned bin for this formulation so it stays clean going
    // forward. Safe under the row lock held above.
    if (formulationId && storage.formulationId === null) {
      await tx
        .update(storageLocations)
        .set({ formulationId, updatedAt: new Date() })
        .where(eq(storageLocations.id, destinationBinId));
    }

    return inserted;
  });

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
    formulationId?: string | null;
    productionDate?: Date;
    status?: "draft" | "testing" | "ready" | "sold";
    linkedProductionRunId?: string | null;
    storageLocationId?: string | null;
    massKg?: number | null;
    moistureContentPercent?: number | null;
    densityKgM3?: number | null;
    waterAddedKg?: number | null;
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
    throw new SafeError("Biochar product not found");
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: biocharProducts.id })
      .from(biocharProducts)
      .where(eq(biocharProducts.code, data.code));

    if (duplicate) {
      throw new SafeError("A biochar product with this code already exists");
    }
  }

  // Verify facility if being changed (must be active)
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), isNull(facilities.archivedAt)));

    if (!facility) {
      throw new SafeError("Facility not found or archived");
    }
  }

  // Verify formulation if being changed
  if (data.formulationId && data.formulationId !== existing.formulationId) {
    const [formulation] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(eq(formulations.id, data.formulationId));

    if (!formulation) {
      throw new SafeError("Formulation not found");
    }
  }

  // The effective facility is the new one if being changed, otherwise the existing one
  const effectiveFacilityId = data.facilityId ?? existing.facilityId;

  // Verify linked production run exists and belongs to same facility
  // Re-validate existing links when facilityId changes
  const facilityChanged = data.facilityId !== undefined && data.facilityId !== existing.facilityId;
  const effectiveLinkedRunId = data.linkedProductionRunId !== undefined
    ? data.linkedProductionRunId
    : existing.linkedProductionRunId;
  const effectiveStorageId = data.storageLocationId !== undefined
    ? data.storageLocationId
    : existing.storageLocationId;
  const effectiveMassKg = data.massKg !== undefined ? data.massKg : existing.massKg;
  const effectiveMoistureContentPercent = data.moistureContentPercent !== undefined
    ? data.moistureContentPercent
    : existing.moistureContentPercent;
  const effectiveWaterAddedKg = data.waterAddedKg !== undefined
    ? data.waterAddedKg
    : existing.waterAddedKg;
  const effectiveComposition =
    data.composition !== undefined
      ? data.composition
      : (existing.composition as Record<string, unknown> | null);

  if (data.linkedProductionRunId !== undefined && !effectiveLinkedRunId) {
    throw new SafeError("Production run is required");
  }

  if (data.storageLocationId !== undefined && !effectiveStorageId) {
    throw new SafeError("Product bin is required");
  }

  if (
    effectiveMassKg != null &&
    (!Number.isFinite(effectiveMassKg) || effectiveMassKg < 0)
  ) {
    throw new SafeError("Wet mass must be a non-negative finite number");
  }

  if (
    effectiveMoistureContentPercent != null &&
    (!Number.isFinite(effectiveMoistureContentPercent) ||
      effectiveMoistureContentPercent < 0 ||
      effectiveMoistureContentPercent > 100)
  ) {
    throw new SafeError("Moisture content must be between 0 and 100");
  }

  if (
    effectiveWaterAddedKg != null &&
    (!Number.isFinite(effectiveWaterAddedKg) || effectiveWaterAddedKg < 0)
  ) {
    throw new SafeError("Water added must be a non-negative finite number");
  }

  if ((data.linkedProductionRunId !== undefined || facilityChanged) && effectiveLinkedRunId) {
    const [run] = await db
      .select({ id: productionRuns.id, facilityId: productionRuns.facilityId })
      .from(productionRuns)
      .where(eq(productionRuns.id, effectiveLinkedRunId));

    if (!run) {
      throw new SafeError("Linked production run not found");
    }
    if (run.facilityId !== effectiveFacilityId) {
      throw new SafeError("Linked production run belongs to a different facility");
    }
  }

  // The effective formulation is the new one if being changed, otherwise existing.
  // A null formulation means a pure-biochar product.
  const effectiveFormulationId =
    data.formulationId !== undefined ? data.formulationId : existing.formulationId;

  // Re-check the destination bin whenever the bin, the formulation, or the
  // facility changes, then update the product and (re)claim an unassigned bin —
  // all atomically. Locking the bin row serializes concurrent placements so two
  // products with different formulations can't strand a mismatch in one bin.
  const updated = await db.transaction(async (tx) => {
    let claimBinFormulationId: string | null = null;

    if (data.composition !== undefined || facilityChanged) {
      await validateCompositionIngredientBins(tx, effectiveComposition, effectiveFacilityId);
    }

    if (
      effectiveStorageId &&
      (data.storageLocationId !== undefined ||
        data.formulationId !== undefined ||
        facilityChanged)
    ) {
      const [storage] = await tx
        .select({
          id: storageLocations.id,
          facilityId: storageLocations.facilityId,
          type: storageLocations.type,
          formulationId: storageLocations.formulationId,
        })
        .from(storageLocations)
        .where(eq(storageLocations.id, effectiveStorageId))
        .for("update");

      if (!storage) {
        throw new SafeError("Storage location not found");
      }
      if (storage.facilityId !== effectiveFacilityId) {
        throw new SafeError("Storage location belongs to a different facility");
      }
      if (storage.type !== "product_bin") {
        throw new SafeError("Storage location must be a product bin");
      }
      if (storage.formulationId !== null && storage.formulationId !== effectiveFormulationId) {
        throw new SafeError(
          "Product bin is reserved for a different formulation. Pick a matching or empty bin."
        );
      }
      if (effectiveFormulationId && storage.formulationId === null) {
        claimBinFormulationId = effectiveFormulationId;
      }
    }

    const [row] = await tx
      .update(biocharProducts)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(biocharProducts.id, productId))
      .returning();

    // Claim an unassigned bin for this formulation so it stays clean going
    // forward. Safe under the row lock held above.
    if (claimBinFormulationId && effectiveStorageId) {
      await tx
        .update(storageLocations)
        .set({ formulationId: claimBinFormulationId, updatedAt: new Date() })
        .where(eq(storageLocations.id, effectiveStorageId));
    }

    return row;
  });

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
    throw new SafeError("Biochar product not found");
  }

  const [[orderCount], [deliveryCount]] = await Promise.all([
    db.select({ count: count() }).from(orders).where(eq(orders.biocharProductId, productId)),
    db.select({ count: count() }).from(deliveries).where(eq(deliveries.biocharProductId, productId)),
  ]);

  if (Number(orderCount.count) > 0) {
    throw new SafeError(
      "Cannot delete biochar product with associated orders. Remove orders first."
    );
  }
  if (Number(deliveryCount.count) > 0) {
    throw new SafeError(
      "Cannot delete biochar product with associated deliveries. Remove deliveries first."
    );
  }

  await db.transaction(async (tx) => {
    await deleteTransportLegsForEntity(tx, "biochar", productId);
    await tx.delete(biocharProducts).where(eq(biocharProducts.id, productId));
  });
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
    .where(isNull(biocharProducts.archivedAt))
    .orderBy(desc(biocharProducts.productionDate));
}
