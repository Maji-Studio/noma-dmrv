/**
 * Storage Locations Data Access Layer
 * CRUD operations for storage locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, SQL, count } from "drizzle-orm";
import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import type { OrgContext } from "@/lib/auth/server";
import {
  storageLocations,
  facilities,
  feedstocks,
  feedstockTypes,
  productionRuns,
  biocharProducts,
  biocharStorageInventory,
  binMovements,
  formulations,
  deliveries,
  orders,
  type StorageLocation,
} from "@/db/schema";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  isFeedstockBinType,
  type StorageLocationFilterData,
  type StorageLocationSortKey,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import { storageLocationLastActivityAt } from "./storage-location-activity";
import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { guardStorageLocationName } from "./unique-name-guards";
import { enrichStorageLocationRows } from "./storage-location-enrichment";
import {
  deriveBinLaneAvailableKg,
  formatKg,
  hasNonZeroStock,
  lockBinStock,
} from "./bin-stock-guards";
import { laneForStorageType } from "@/schemas/bin-movements";
import { deriveLaneStock } from "./lane-stock-derivation";
import type {
  StorageLocationWithFacility,
  PaginatedStorageLocations,
  StorageLocationLastActivity,
} from "./storage-location-enrichment";

// Re-exported so existing importers (hooks, fn) keep their import paths.
export type {
  StorageLocationWithFacility,
  PaginatedStorageLocations,
  StorageLocationLastActivity,
};

/**
 * Non-null columns the list can sort by, ordered with Drizzle's `asc`/`desc`.
 * The two nullable keys are absent on purpose: `lastActivityAt` is derived, and
 * `capacityKg` needs an explicit NULLS LAST. Both are handled in
 * `getStorageLocations`.
 */
const SORT_COLUMNS: Partial<Record<StorageLocationSortKey, AnyPgColumn>> = {
  code: storageLocations.code,
  name: storageLocations.name,
  type: storageLocations.type,
  createdAt: storageLocations.createdAt,
  updatedAt: storageLocations.updatedAt,
};

async function getStorageLocationLaneSummary(
  ctx: OrgContext,
  options: { facilityId?: string; archived: boolean },
): Promise<
  Record<StorageLocationType, { binCount: number; onHandKg: number }>
> {
  requireOrgScope(ctx);
  const conditions: SQL[] = [
    eq(storageLocations.organizationId, ctx.organizationId),
    options.archived
      ? isNotNull(storageLocations.archivedAt)
      : isNull(storageLocations.archivedAt),
  ];
  if (options.facilityId) {
    conditions.push(eq(storageLocations.facilityId, options.facilityId));
  }

  // org-scope-ok: conditions always starts with the active organization predicate.
  const bins = await db
    .select({ id: storageLocations.id, type: storageLocations.type })
    .from(storageLocations)
    .where(and(...conditions));
  const storageLocationIds = bins.map((bin) => bin.id);
  const laneStocks = await deriveLaneStock(ctx, db, { storageLocationIds });
  const laneStockById = new Map(
    laneStocks.map((stock) => [stock.storageLocationId, stock]),
  );
  const productBinIds = bins
    .filter((bin) => bin.type === "product_bin")
    .map((bin) => bin.id);
  const [productRows, deliveredRows] =
    productBinIds.length > 0
      ? await Promise.all([
          db
            .select({
              storageLocationId: biocharProducts.storageLocationId,
              total: sumNumeric(biocharProducts.massKg),
            })
            .from(biocharProducts)
            .where(
              and(
                inArray(biocharProducts.storageLocationId, productBinIds),
                eq(biocharProducts.organizationId, ctx.organizationId),
              ),
            )
            .groupBy(biocharProducts.storageLocationId),
          db
            .select({
              storageLocationId: biocharProducts.storageLocationId,
              total: sumNumeric(deliveries.deliveredWetMassKg),
            })
            .from(deliveries)
            .innerJoin(
              orders,
              and(
                eq(deliveries.orderId, orders.id),
                eq(orders.organizationId, ctx.organizationId),
              ),
            )
            .innerJoin(
              biocharProducts,
              and(
                sql`${biocharProducts.id} = COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
                eq(biocharProducts.organizationId, ctx.organizationId),
              ),
            )
            .where(
              and(
                eq(deliveries.status, "delivered"),
                eq(deliveries.organizationId, ctx.organizationId),
                inArray(biocharProducts.storageLocationId, productBinIds),
              ),
            )
            .groupBy(biocharProducts.storageLocationId),
        ])
      : [[], []];
  const productById = new Map(
    productRows.flatMap((row) =>
      row.storageLocationId ? [[row.storageLocationId, row.total] as const] : [],
    ),
  );
  const deliveredById = new Map(
    deliveredRows.flatMap((row) =>
      row.storageLocationId ? [[row.storageLocationId, row.total] as const] : [],
    ),
  );
  const summary: Record<
    StorageLocationType,
    { binCount: number; onHandKg: number }
  > = {
    feedstock_bin: { binCount: 0, onHandKg: 0 },
    biochar_bin: { binCount: 0, onHandKg: 0 },
    product_bin: { binCount: 0, onHandKg: 0 },
  };

  for (const bin of bins) {
    const stock = laneStockById.get(bin.id);
    summary[bin.type].binCount += 1;
    if (bin.type === "feedstock_bin") {
      summary[bin.type].onHandKg += stock?.feedstockStockDryKg ?? 0;
    } else if (bin.type === "biochar_bin") {
      summary[bin.type].onHandKg += stock?.biocharStockKg ?? 0;
    } else {
      summary[bin.type].onHandKg +=
        (productById.get(bin.id) ?? 0) -
        (deliveredById.get(bin.id) ?? 0) +
        (stock?.productMovementDeltaKg ?? 0);
    }
  }

  return summary;
}

// ============================================
// Read Operations
// ============================================

/**
 * Get all storage bins with pagination and filtering
 * Supports search, facility filter, type filter, sorting, and pagination
 */
export async function getStorageLocations(
  ctx: OrgContext,
  filters?: Partial<StorageLocationFilterData>
): Promise<PaginatedStorageLocations> {
  requireOrgScope(ctx);

  const {
    search,
    facilityId,
    type,
    archived = false,
    page = 1,
    pageSize = 20,
    sortBy = "code",
    sortOrder = "asc",
  } = filters ?? {};

  // Active bins by default; the archived view is explicit and restore-oriented.
  const conditions: SQL[] = [
    eq(storageLocations.organizationId, ctx.organizationId),
    archived
      ? isNotNull(storageLocations.archivedAt)
      : isNull(storageLocations.archivedAt),
  ];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(storageLocations.code, searchPattern),
        ilike(storageLocations.name, searchPattern)
      )!
    );
  }

  if (facilityId) {
    conditions.push(eq(storageLocations.facilityId, facilityId));
  }

  if (type) {
    conditions.push(eq(storageLocations.type, type));
  }

  const whereClause = and(...conditions);

  // Build sort clause. Two of the sort keys are nullable, and for both of them a
  // missing value means "not applicable", never "smallest" — so both pin their
  // nulls to the end in *either* direction rather than taking Postgres's
  // default (NULLS LAST on ASC, NULLS FIRST on DESC, which would lead the
  // "Largest capacity" board with every uncapped bin).
  const direction = sortOrder === "desc" ? sql`DESC` : sql`ASC`;
  const primaryOrder =
    sortBy === "lastActivityAt"
      ? sql`${storageLocationLastActivityAt(ctx.organizationId)} ${direction} NULLS LAST`
      : sortBy === "capacityKg"
        ? sql`${storageLocations.capacityKg} ${direction} NULLS LAST`
        : (sortOrder === "desc" ? desc : asc)(
            SORT_COLUMNS[sortBy] ?? storageLocations.code,
          );
  // Code breaks every tie. Without it, rows sharing a sort value (every bin of
  // one type, every bin with no activity) come back in whatever order the plan
  // produced, and a row can repeat on page 2 after appearing on page 1.
  const orderBy =
    sortBy === "code" ? [primaryOrder] : [primaryOrder, asc(storageLocations.code)];

  // Count total for pagination
  // org-scope-ok: whereClause includes the active organization predicate.
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(storageLocations)
    .where(whereClause);

  const total = Number(totalCount);
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get storage bins with facility info
  const storageLocationList = await db
    .select({
      id: storageLocations.id,
      organizationId: storageLocations.organizationId,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      capacityKg: storageLocations.capacityKg,
      storageMethod: storageLocations.storageMethod,
      storageDescription: storageLocations.storageDescription,
      supplierReferenceId: storageLocations.supplierReferenceId,
      feedstockTypeId: storageLocations.feedstockTypeId,
      formulationId: storageLocations.formulationId,
      facilityId: storageLocations.facilityId,
      archivedAt: storageLocations.archivedAt,
      createdAt: storageLocations.createdAt,
      updatedAt: storageLocations.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      feedstockTypeName: feedstockTypes.name,
      formulationName: formulations.name,
    })
    .from(storageLocations)
    .leftJoin(
      facilities,
      and(
        eq(storageLocations.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      feedstockTypes,
      and(
        eq(storageLocations.feedstockTypeId, feedstockTypes.id),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      formulations,
      and(
        eq(storageLocations.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset(offset);

  const items = await enrichStorageLocationRows(ctx, storageLocationList);
  const laneSummary = await getStorageLocationLaneSummary(ctx, {
    facilityId,
    archived,
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    laneSummary,
  };
}

/**
 * Get a single storage bin by ID
 * Returns storage bin data without relations
 */
export async function getStorageLocationById(
  ctx: OrgContext,
  storageLocationId: string
): Promise<StorageLocation> {
  requireOrgScope(ctx);

  const [storageLocation] = await db
    .select()
    .from(storageLocations)
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!storageLocation) {
    throw new SafeError("Storage bin not found");
  }

  return storageLocation;
}

/**
 * Get a single storage bin by ID with facility info
 */
export async function getStorageLocationWithFacility(
  ctx: OrgContext,
  storageLocationId: string
): Promise<StorageLocationWithFacility> {
  requireOrgScope(ctx);

  const [result] = await db
    .select({
      id: storageLocations.id,
      organizationId: storageLocations.organizationId,
      code: storageLocations.code,
      name: storageLocations.name,
      type: storageLocations.type,
      capacityKg: storageLocations.capacityKg,
      storageMethod: storageLocations.storageMethod,
      storageDescription: storageLocations.storageDescription,
      supplierReferenceId: storageLocations.supplierReferenceId,
      feedstockTypeId: storageLocations.feedstockTypeId,
      formulationId: storageLocations.formulationId,
      facilityId: storageLocations.facilityId,
      archivedAt: storageLocations.archivedAt,
      createdAt: storageLocations.createdAt,
      updatedAt: storageLocations.updatedAt,
      facilityCode: facilities.code,
      facilityName: facilities.name,
      feedstockTypeName: feedstockTypes.name,
      formulationName: formulations.name,
    })
    .from(storageLocations)
    .leftJoin(
      facilities,
      and(
        eq(storageLocations.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      feedstockTypes,
      and(
        eq(storageLocations.feedstockTypeId, feedstockTypes.id),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      formulations,
      and(
        eq(storageLocations.formulationId, formulations.id),
        eq(formulations.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!result) {
    throw new SafeError("Storage bin not found");
  }

  const [enriched] = await enrichStorageLocationRows(ctx, [result]);

  return enriched;
}

/**
 * Get storage bins by facility ID
 */
export async function getStorageLocationsByFacility(
  ctx: OrgContext,
  facilityId: string
): Promise<StorageLocation[]> {
  requireOrgScope(ctx);

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)));

  if (!facility) {
    throw new SafeError("Facility not found");
  }

  return db
    .select()
    .from(storageLocations)
    .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.organizationId, ctx.organizationId), isNull(storageLocations.archivedAt)))
    .orderBy(asc(storageLocations.code));
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new storage bin
 */
export async function createStorageLocation(
  ctx: OrgContext,
  data: {
    code: string;
    name: string;
    type: "feedstock_bin" | "biochar_bin" | "product_bin";
    facilityId: string;
    capacityKg?: number | null;
    feedstockTypeId?: string | null;
    formulationId?: string | null;
    storageMethod?: string | null;
    storageDescription?: string | null;
    supplierReferenceId?: string | null;
  }
): Promise<StorageLocation> {
  requireOrgScope(ctx);

  // Verify facility exists and is active (no new children under an archived parent)
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }

  if (data.feedstockTypeId) {
    const [feedstockType] = await db
      .select({ id: feedstockTypes.id })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

    if (!feedstockType) {
      throw new SafeError("Feedstock type not found");
    }
  }

  // The Zod create schema enforces this for form/fn flows; repeat it here so
  // direct data-access callers (seeds, scripts) can't create a bin the update
  // path's invariant check would then refuse to touch.
  if (isFeedstockBinType(data.type) && !data.feedstockTypeId) {
    throw new SafeError(
      "Feedstock bins must be restricted to one feedstock type"
    );
  }

  // A formulation only makes sense on a product bin; ignore it for other types.
  const formulationId = data.type === "product_bin" ? data.formulationId ?? null : null;
  if (formulationId) {
    const [formulation] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(and(eq(formulations.id, formulationId), eq(formulations.organizationId, ctx.organizationId)));

    if (!formulation) {
      throw new SafeError("Formulation not found");
    }
  }

  const [storageLocation] = await guardStorageLocationName(ctx, data.name, () =>
    db
      .insert(storageLocations)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        name: data.name,
        type: data.type,
        facilityId: data.facilityId,
        capacityKg: data.capacityKg ?? null,
        // Only meaningful on feedstock bins, like formulationId below.
        feedstockTypeId: isFeedstockBinType(data.type)
          ? data.feedstockTypeId ?? null
          : null,
        formulationId,
        storageMethod: data.storageMethod ?? null,
        storageDescription: data.storageDescription ?? null,
        supplierReferenceId: data.supplierReferenceId ?? null,
      })
      .returning()
  );

  return storageLocation;
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing storage bin
 */
export async function updateStorageLocation(
  ctx: OrgContext,
  storageLocationId: string,
  data: {
    code?: string;
    name?: string;
    type?: "feedstock_bin" | "biochar_bin" | "product_bin";
    facilityId?: string;
    capacityKg?: number | null;
    feedstockTypeId?: string | null;
    formulationId?: string | null;
    storageMethod?: string | null;
    storageDescription?: string | null;
    supplierReferenceId?: string | null;
  }
): Promise<StorageLocation> {
  requireOrgScope(ctx);

  // Verify storage bin exists
  const [existing] = await db
    .select()
    .from(storageLocations)
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Storage bin not found");
  }
  if (existing.archivedAt) {
    throw new SafeError(
      "Restore this storage bin before editing it",
    );
  }

  // If code is being changed, check for duplicates
  if (data.code && data.code !== existing.code) {
    const [duplicate] = await db
      .select({ id: storageLocations.id })
      .from(storageLocations)
      .where(and(eq(storageLocations.code, data.code), eq(storageLocations.organizationId, ctx.organizationId)));

    if (duplicate) {
      throw new SafeError("A storage bin with this code already exists");
    }
  }

  // If facilityId is being changed, verify new facility exists and is active
  if (data.facilityId && data.facilityId !== existing.facilityId) {
    const [facility] = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

    if (!facility) {
      throw new SafeError("Facility not found or archived");
    }
  }

  if (data.feedstockTypeId) {
    const [feedstockType] = await db
      .select({ id: feedstockTypes.id })
      .from(feedstockTypes)
      .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

    if (!feedstockType) {
      throw new SafeError("Feedstock type not found");
    }
  }

  const effectiveType = data.type ?? existing.type;

  // The Zod update schema can only see the payload — when `type` is omitted it
  // cannot tell this is a feedstock bin, so an update could clear
  // feedstockTypeId on one. Enforce the invariant against the effective row.
  const effectiveFeedstockTypeId =
    data.feedstockTypeId !== undefined
      ? data.feedstockTypeId
      : existing.feedstockTypeId;
  if (
    isFeedstockBinType(effectiveType as StorageLocationType) &&
    !effectiveFeedstockTypeId
  ) {
    throw new SafeError(
      "Feedstock bins must be restricted to one feedstock type"
    );
  }

  // A feedstock type only makes sense on a feedstock bin — clear it
  // when the (effective) type is anything else, same as formulationId below.
  const normalizedFeedstockTypeId = isFeedstockBinType(
    effectiveType as StorageLocationType
  )
    ? effectiveFeedstockTypeId ?? null
    : null;

  const normalizedFormulationId =
    effectiveType === "product_bin"
      ? (data.formulationId !== undefined
          ? data.formulationId
          : existing.formulationId) ?? null
      : null;

  if (normalizedFormulationId) {
    const [formulation] = await db
      .select({ id: formulations.id })
      .from(formulations)
      .where(and(eq(formulations.id, normalizedFormulationId), eq(formulations.organizationId, ctx.organizationId)));

    if (!formulation) {
      throw new SafeError("Formulation not found");
    }
  }

  // Don't let a product bin's formulation be re-pointed while it still holds
  // product of a different formulation — that would dirty the bin. `IS DISTINCT
  // FROM` handles NULL correctly (a pure-biochar product vs a named formulation
  // counts as a mismatch, and vice versa).
  if (effectiveType === "product_bin") {
    const [conflicting] = await db
      .select({ id: biocharProducts.id })
      .from(biocharProducts)
      .where(
        and(
          eq(biocharProducts.storageLocationId, storageLocationId),
          eq(biocharProducts.organizationId, ctx.organizationId),
          sql`${biocharProducts.formulationId} IS DISTINCT FROM ${normalizedFormulationId}`
        )
      )
      .limit(1);

    if (conflicting) {
      throw new SafeError(
        "This storage bin holds a product with a different formulation. Move or remove the product before changing the bin's formulation."
      );
    }
  }

  const dataWithoutNormalized = { ...data };
  delete dataWithoutNormalized.formulationId;
  delete dataWithoutNormalized.feedstockTypeId;
  // A rename OR a facility move can collide with the per-facility name index.
  const [updated] = await guardStorageLocationName(
    ctx,
    data.name ?? existing.name,
    () =>
      db
        .update(storageLocations)
        .set({
          ...dataWithoutNormalized,
          feedstockTypeId: normalizedFeedstockTypeId,
          formulationId: normalizedFormulationId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storageLocations.id, storageLocationId),
            eq(storageLocations.organizationId, ctx.organizationId),
            isNull(storageLocations.archivedAt),
          ),
        )
        .returning()
  );

  if (!updated) {
    throw new SafeError(
      "Restore this storage bin before editing it",
    );
  }

  return updated;
}

// ============================================
// Archive Operations
// ============================================

/**
 * Archive one storage bin without disturbing its operational history.
 */
export async function archiveStorageLocation(
  ctx: OrgContext,
  storageLocationId: string,
): Promise<StorageLocation> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    await lockBinStock(ctx, tx, storageLocationId);
    const [existing] = await tx
      .select({
        id: storageLocations.id,
        type: storageLocations.type,
        archivedAt: storageLocations.archivedAt,
      })
      .from(storageLocations)
      .where(
        and(
          eq(storageLocations.id, storageLocationId),
          eq(storageLocations.organizationId, ctx.organizationId),
        ),
      );

    if (!existing) {
      throw new SafeError("Storage bin not found");
    }
    if (existing.archivedAt) {
      throw new SafeError("Storage bin is already archived");
    }

    const lane = laneForStorageType(existing.type);
    const availableKg = await deriveBinLaneAvailableKg(
      ctx,
      tx,
      storageLocationId,
      lane,
    );
    if (hasNonZeroStock(availableKg)) {
      throw new SafeError(
        `Cannot archive this storage bin while it has ${formatKg(availableKg)} on hand. Reconcile or draw the bin down to zero first.`,
      );
    }

    const archivedAt = new Date();
    const [archived] = await tx
      .update(storageLocations)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(
        and(
          eq(storageLocations.id, storageLocationId),
          eq(storageLocations.organizationId, ctx.organizationId),
          isNull(storageLocations.archivedAt),
        ),
      )
      .returning();

    if (!archived) {
      throw new SafeError("Storage bin is already archived");
    }

    return archived;
  });
}

/**
 * Restore one archived storage bin. Its facility must be active first.
 */
export async function restoreStorageLocation(
  ctx: OrgContext,
  storageLocationId: string,
): Promise<StorageLocation> {
  requireOrgScope(ctx);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: storageLocations.id,
        archivedAt: storageLocations.archivedAt,
        facilityArchivedAt: facilities.archivedAt,
      })
      .from(storageLocations)
      .innerJoin(
        facilities,
        and(
          eq(storageLocations.facilityId, facilities.id),
          eq(facilities.organizationId, ctx.organizationId),
        ),
      )
      .where(
        and(
          eq(storageLocations.id, storageLocationId),
          eq(storageLocations.organizationId, ctx.organizationId),
        ),
      )
      .for("update");

    if (!existing) {
      throw new SafeError("Storage bin not found");
    }
    if (!existing.archivedAt) {
      throw new SafeError("Storage bin is not archived");
    }
    if (existing.facilityArchivedAt) {
      throw new SafeError(
        "Restore the facility before restoring this storage bin",
      );
    }

    const [restored] = await tx
      .update(storageLocations)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(storageLocations.id, storageLocationId),
          eq(storageLocations.organizationId, ctx.organizationId),
          isNotNull(storageLocations.archivedAt),
        ),
      )
      .returning();

    if (!restored) {
      throw new SafeError("Storage bin is not archived");
    }

    return restored;
  });
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a storage bin
 * Permanent deletion is reserved for bins with no operational history.
 */
export async function deleteStorageLocation(
  ctx: OrgContext,
  storageLocationId: string
): Promise<void> {
  requireOrgScope(ctx);

  // Verify storage bin exists
  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));

  if (!existing) {
    throw new SafeError("Storage bin not found");
  }

  const [
    [{ value: feedstockCount }],
    [{ value: feedstockRunCount }],
    [{ value: biocharRunCount }],
    [{ value: productCount }],
    [{ value: deliveryCount }],
    [{ value: inventoryCount }],
    [{ value: movementCount }],
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(feedstocks)
      .where(and(eq(feedstocks.storageLocationId, storageLocationId), eq(feedstocks.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(productionRuns)
      .where(and(eq(productionRuns.feedstockStorageLocationId, storageLocationId), eq(productionRuns.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(productionRuns)
      .where(and(eq(productionRuns.biocharStorageLocationId, storageLocationId), eq(productionRuns.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(biocharProducts)
      .where(and(eq(biocharProducts.storageLocationId, storageLocationId), eq(biocharProducts.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(deliveries)
      .where(and(eq(deliveries.storageLocationId, storageLocationId), eq(deliveries.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(biocharStorageInventory)
      .where(and(eq(biocharStorageInventory.storageLocationId, storageLocationId), eq(biocharStorageInventory.organizationId, ctx.organizationId))),
    db
      .select({ value: count() })
      .from(binMovements)
      .where(and(eq(binMovements.storageLocationId, storageLocationId), eq(binMovements.organizationId, ctx.organizationId))),
  ]);

  const blockers = [
    Number(feedstockCount) > 0 ? "feedstock batches" : null,
    Number(feedstockRunCount) > 0 ? "production runs using it as a feedstock bin" : null,
    Number(biocharRunCount) > 0 ? "production runs using it as a biochar bin" : null,
    Number(productCount) > 0 ? "biochar products stored in it" : null,
    Number(deliveryCount) > 0 ? "deliveries drawing from it" : null,
    Number(inventoryCount) > 0 ? "storage inventory records" : null,
    Number(movementCount) > 0 ? "reconciliation or movement history" : null,
  ].filter(Boolean);

  if (blockers.length > 0) {
    throw new SafeError(
      `Cannot delete this storage bin while it has ${blockers.join(", ")}. Move or remove those records first.`
    );
  }

  await db
    .delete(storageLocations)
    .where(and(eq(storageLocations.id, storageLocationId), eq(storageLocations.organizationId, ctx.organizationId)));
}

// ============================================
// Utility Operations
// ============================================

/**
 * Check if a storage bin code is available
 */
export async function isStorageLocationCodeAvailable(
  ctx: OrgContext,
  code: string,
  excludeStorageLocationId?: string
): Promise<boolean> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [eq(storageLocations.code, code), eq(storageLocations.organizationId, ctx.organizationId)];

  if (excludeStorageLocationId) {
    conditions.push(
      sql`${storageLocations.id} != ${excludeStorageLocationId}`
    );
  }

  // org-scope-ok: organization predicate is composed in conditions above.
  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(and(...conditions));

  return !existing;
}

/**
 * Get unique storage types used across all storage locations
 */
export async function getStorageLocationTypes(
  ctx: OrgContext
): Promise<string[]> {
  requireOrgScope(ctx);

  const results = await db
    .selectDistinct({ type: storageLocations.type })
    .from(storageLocations)
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), isNull(storageLocations.archivedAt)))
    .orderBy(asc(storageLocations.type));

  return results.map((r) => r.type);
}
