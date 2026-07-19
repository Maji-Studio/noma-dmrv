/**
 * Biochar Products Data Access Layer
 * CRUD operations for biochar products with auth guards, pagination, filtering, and relations
 */

import { and, asc, desc, eq, ilike, isNull, or, sql, SQL, count } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
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
import { parseLocalDateString } from "@/lib/date-utils";

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
// Helpers
// ============================================

/**
 * The biochar product's production date IS the linked production run's date —
 * when the biochar was produced, not when the product (its blend) was mixed.
 * The run's `date` column is a calendar day ("YYYY-MM-DD"); parse it at LOCAL
 * midnight (#46) so the stored timestamp lands on the same day it would have via
 * the form, with no UTC day-shift.
 */
function runDateToProductionDate(runDate: string | Date): Date {
  return runDate instanceof Date ? runDate : parseLocalDateString(runDate);
}

// ============================================
// Auth Guards
// ============================================

import { requireOrgScope } from "./utils";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { SafeError } from "@/lib/errors";
import { deleteTransportLegsForEntity } from "./transport-legs";
import { retireDocumentsForEntities } from "./documents";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { validateCompositionIngredientBins } from "./biochar-product-composition";
import { assertBiocharDrawWithinStock } from "./bin-stock-guards";
import { lockBinStocks } from "./lock-bin-stocks";
import {
  CODE_CONFLICT_MESSAGES,
  withUniqueCodeGuard,
} from "./code-generator";
import {
  assertBiocharProductMassReductionWithinStock,
  assertBiocharProductUpdateDraw,
  biocharEquivalentKg,
  lockBiocharProductUpdateRows,
  lockBiocharProductUpdateStock,
  lockDeleteBiocharProductStock,
} from "./biochar-product-stock-locks";

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
    .leftJoin(facilities, and(eq(biocharProducts.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(biocharProducts.storageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)))
    .leftJoin(productionRuns, and(eq(biocharProducts.linkedProductionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
  productId: string
): Promise<BiocharProductWithRelations> {
  requireOrgScope(ctx);

  const [row] = await db
    .select({
      id: biocharProducts.id,
      organizationId: biocharProducts.organizationId,
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
    .leftJoin(facilities, and(eq(biocharProducts.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .leftJoin(formulations, and(eq(biocharProducts.formulationId, formulations.id), eq(formulations.organizationId, ctx.organizationId)))
    .leftJoin(storageLocations, and(eq(biocharProducts.storageLocationId, storageLocations.id), eq(storageLocations.organizationId, ctx.organizationId)))
    .leftJoin(productionRuns, and(eq(biocharProducts.linkedProductionRunId, productionRuns.id), eq(productionRuns.organizationId, ctx.organizationId)))
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
  ctx: OrgContext,
  data: {
    code: string;
    facilityId: string;
    formulationId?: string | null;
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
  requireOrgScope(ctx);

  // A null formulation means a pure-biochar product (no amendment blend).
  const formulationId = data.formulationId ?? null;

  // Verify facility exists and is active; verify the formulation only when one
  // was provided. The lookups are independent, so run them in parallel — but
  // evaluate the results in a fixed order so the surfaced error stays
  // deterministic (facility before formulation).
  const [[facility], formulationRows] = await Promise.all([
    db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt))),
    formulationId
      ? db
          .select({ id: formulations.id })
          .from(formulations)
          .where(and(eq(formulations.id, formulationId), eq(formulations.organizationId, ctx.organizationId)))
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

  // Validate the linked production run (independent, read-only). Its date is the
  // biochar's production date, stamped onto the product below.
  const [run] = await db
    .select({
      id: productionRuns.id,
      facilityId: productionRuns.facilityId,
      date: productionRunDateExpr(),
      biocharStorageLocationId: productionRuns.biocharStorageLocationId,
    })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, data.linkedProductionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!run) {
    throw new SafeError("Linked production run not found");
  }
  if (run.facilityId !== data.facilityId) {
    throw new SafeError("Linked production run belongs to a different facility");
  }

  const productionDate = runDateToProductionDate(run.date);

  // Biochar ratio scales the wet mass to the biochar-equivalent draw (#116).
  const [formulationRatioRow] = formulationId
    ? await db
        .select({ biocharRatio: formulations.biocharRatio })
        .from(formulations)
        .where(and(eq(formulations.id, formulationId), eq(formulations.organizationId, ctx.organizationId)))
    : [];
  const biocharRatio = formulationRatioRow?.biocharRatio ?? null;

  const destinationBinId = data.storageLocationId;

  // Lock the destination bin, validate it, insert the product, and claim the bin
  // atomically. The row lock serializes concurrent placements into the same bin,
  // so two products with different formulations can't both pass the reservation
  // check and strand a mismatched product (the claim-after-insert TOCTOU).
  const product = await db.transaction(async (tx) => {
    const [lockedRun] = await tx
      .select({
        id: productionRuns.id,
        biocharStorageLocationId: productionRuns.biocharStorageLocationId,
      })
      .from(productionRuns)
      .where(and(
        eq(productionRuns.id, run.id),
        eq(productionRuns.organizationId, ctx.organizationId),
      ))
      .for("update");

    if (!lockedRun) {
      throw new SafeError("Linked production run not found");
    }

    // A submitted production run can't gain new source inventory after
    // certification. Mirror the update/delete guards so the create path can't
    // bypass certification locking by attaching a fresh product to a locked run.
    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "productionRun", entityId: run.id },
      "create",
    );

    await lockBinStocks(
      ctx,
      tx,
      [
        (data.massKg ?? 0) > 0 ? destinationBinId : null,
        lockedRun.biocharStorageLocationId,
      ],
    );

    await validateCompositionIngredientBins(
      ctx,
      tx,
      data.composition,
      formulationId,
      data.facilityId
    );

    const [storage] = await tx
      .select({
        id: storageLocations.id,
        facilityId: storageLocations.facilityId,
        type: storageLocations.type,
        formulationId: storageLocations.formulationId,
      })
      .from(storageLocations)
      .where(and(eq(storageLocations.id, destinationBinId), eq(storageLocations.organizationId, ctx.organizationId)))
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

    // Hard-block a biochar draw that exceeds the source biochar bin's derived
    // on-hand stock (#116). Skip when the run has no biochar bin to draw from.
    if (lockedRun.biocharStorageLocationId) {
      await assertBiocharDrawWithinStock(ctx, tx, {
        biocharStorageLocationId: lockedRun.biocharStorageLocationId,
        requestedBiocharKg: biocharEquivalentKg(data.massKg ?? null, biocharRatio),
      });
    }

    const [inserted] = await tx
      .insert(biocharProducts)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        facilityId: data.facilityId,
        formulationId,
        productionDate,
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
        .where(and(eq(storageLocations.id, destinationBinId), eq(storageLocations.organizationId, ctx.organizationId)));
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
  ctx: OrgContext,
  productId: string,
  data: {
    code?: string;
    facilityId?: string;
    formulationId?: string | null;
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
  requireOrgScope(ctx);

  // Verify product exists
  const [existing] = await db
    .select()
    .from(biocharProducts)
    .where(and(eq(biocharProducts.id, productId), eq(biocharProducts.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Biochar product not found");
  }

  // Verify facility if being changed (must be active)
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

    if (!facility) {
      throw new SafeError("Facility not found or archived");
    }
  }

  // Verify formulation if being changed
  if (data.formulationId && data.formulationId !== existing.formulationId) {
    const [formulation] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(and(eq(formulations.id, data.formulationId), eq(formulations.organizationId, ctx.organizationId)));

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

  // When the linked run is (re)assigned, the product's production date follows
  // it — the date tracks when the biochar was produced, not when its blend was
  // mixed. Left undefined (date unchanged) when only the run is re-validated for
  // a facility change without the run itself moving.
  let derivedProductionDate: Date | undefined;
  if ((data.linkedProductionRunId !== undefined || facilityChanged) && effectiveLinkedRunId) {
    const [run] = await db
      .select({
        id: productionRuns.id,
        facilityId: productionRuns.facilityId,
        date: productionRunDateExpr(),
      })
      .from(productionRuns)
      .where(and(eq(productionRuns.id, effectiveLinkedRunId), eq(productionRuns.organizationId, ctx.organizationId)));

    if (!run) {
      throw new SafeError("Linked production run not found");
    }
    if (run.facilityId !== effectiveFacilityId) {
      throw new SafeError("Linked production run belongs to a different facility");
    }
    if (data.linkedProductionRunId !== undefined) {
      derivedProductionDate = runDateToProductionDate(run.date);
    }
  }

  // Re-check the destination bin whenever the bin, the formulation, or the
  // facility changes, then update the product and (re)claim an unassigned bin —
  // all atomically. Locking the bin row serializes concurrent placements so two
  // products with different formulations can't strand a mismatch in one bin.
  const updated = await withUniqueCodeGuard(
    ctx,
    biocharProducts,
    biocharProducts.code,
    CODE_CONFLICT_MESSAGES.biocharProduct,
    () => db.transaction(async (tx) => {
    const stockPreparation = await lockBiocharProductUpdateStock(
      ctx,
      tx,
      existing,
      data,
    );

    const [locked] = await tx
      .select()
      .from(biocharProducts)
      .where(and(
        eq(biocharProducts.id, productId),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ))
      .for("update");

    if (!locked) {
      throw new SafeError("Biochar product not found");
    }

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "biocharProduct", entityId: productId },
      "update",
    );

    const stockState = await lockBiocharProductUpdateRows(
      ctx,
      tx,
      locked,
      data,
      stockPreparation,
    );
    const {
      transactionFacilityId,
      transactionFormulationId,
      transactionLinkedRunId,
      transactionStorageId,
      transactionMassKg,
      transactionComposition,
    } = stockState;

    await assertBiocharProductMassReductionWithinStock(
      ctx,
      tx,
      productId,
      locked,
      data,
    );

    let claimBinFormulationId: string | null = null;

    if (data.composition !== undefined || data.formulationId !== undefined || facilityChanged) {
      await validateCompositionIngredientBins(
        ctx,
        tx,
        transactionComposition,
        transactionFormulationId,
        transactionFacilityId
      );
    }

    if (
      transactionStorageId &&
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
        .where(and(eq(storageLocations.id, transactionStorageId), eq(storageLocations.organizationId, ctx.organizationId)))
        .for("update");

      if (!storage) {
        throw new SafeError("Storage location not found");
      }
      if (storage.facilityId !== transactionFacilityId) {
        throw new SafeError("Storage location belongs to a different facility");
      }
      if (storage.type !== "product_bin") {
        throw new SafeError("Storage location must be a product bin");
      }
      if (storage.formulationId !== null && storage.formulationId !== transactionFormulationId) {
        throw new SafeError(
          "Product bin is reserved for a different formulation. Pick a matching or empty bin."
        );
      }
      if (transactionFormulationId && storage.formulationId === null) {
        claimBinFormulationId = transactionFormulationId;
      }
    }

    await assertBiocharProductUpdateDraw(ctx, tx, productId, data, {
      transactionFacilityId,
      transactionFormulationId,
      transactionLinkedRunId,
      transactionStorageId,
      transactionMassKg,
      transactionComposition,
    });

    const [row] = await tx
      .update(biocharProducts)
      .set({
        ...data,
        ...(derivedProductionDate && { productionDate: derivedProductionDate }),
        updatedAt: new Date(),
      })
      .where(and(eq(biocharProducts.id, productId), eq(biocharProducts.organizationId, ctx.organizationId)))
      .returning();

    // Claim an unassigned bin for this formulation so it stays clean going
    // forward. Safe under the row lock held above.
    if (claimBinFormulationId && transactionStorageId) {
      await tx
        .update(storageLocations)
        .set({ formulationId: claimBinFormulationId, updatedAt: new Date() })
        .where(and(eq(storageLocations.id, transactionStorageId), eq(storageLocations.organizationId, ctx.organizationId)));
    }

    return row;
    }),
  );

  return updated;
}

// ============================================
// Biochar Product Delete Operations
// ============================================

/**
 * Delete a biochar product
 */
export async function deleteBiocharProduct(
  ctx: OrgContext,
  productId: string
): Promise<void> {
  requireOrgScope(ctx);

  await db.transaction(async (tx) => {
    await lockDeleteBiocharProductStock(ctx, tx, productId);

    await assertCanMutateCertifiedLineage(
      ctx,
      tx,
      { entityType: "biocharProduct", entityId: productId },
      "delete",
    );

    const [orderCount] = await tx
      .select({ count: count() })
      .from(orders)
      .where(and(eq(orders.biocharProductId, productId), eq(orders.organizationId, ctx.organizationId)));
    const [deliveryCount] = await tx
      .select({ count: count() })
      .from(deliveries)
      .where(and(eq(deliveries.biocharProductId, productId), eq(deliveries.organizationId, ctx.organizationId)));

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

    await deleteTransportLegsForEntity(ctx, tx, "biochar", productId);
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "biochar_product", entityId: productId },
    ]);
    await tx.delete(biocharProducts).where(and(eq(biocharProducts.id, productId), eq(biocharProducts.organizationId, ctx.organizationId)));
  });
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a biochar product code is available
 */
export async function isBiocharProductCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeProductId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.code, code)];

  if (excludeProductId) {
    conditions.push(sql`${biocharProducts.id} != ${excludeProductId}`);
  }

  // org-scope-ok: organization predicate is composed in conditions above.
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
  ctx: OrgContext
): Promise<Array<{ id: string; code: string }>> {
  requireOrgScope(ctx);

  return db
    .select({
      id: biocharProducts.id,
      code: biocharProducts.code,
    })
    .from(biocharProducts)
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), isNull(biocharProducts.archivedAt)))
    .orderBy(desc(biocharProducts.productionDate));
}
