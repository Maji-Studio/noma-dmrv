/**
 * Storage Locations Data Access Layer
 * CRUD operations for storage locations with auth guards, pagination, and filtering
 */

import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, SQL, count } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  storageLocations,
  facilities,
  feedstockTypes,
  biocharProducts,
  formulations,
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
import { assertBinIdentityChangeAllowed } from "./storage-location-identity-guards";
import {
  countStorageLocationReferences,
  storageLocationBlockers,
} from "./storage-location-references";
import { getStorageLocationLaneSummary } from "./storage-location-lane-summary";
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

/** Re-read one editable bin, rejecting a missing or archived row. */
async function readEditableStorageLocation(
  ctx: OrgContext,
  tx: DbTransaction,
  storageLocationId: string,
): Promise<StorageLocation> {
  const [existing] = await tx
    .select()
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
    throw new SafeError("Restore this storage bin before editing it");
  }
  return existing;
}

/**
 * Update an existing storage bin.
 *
 * Runs under the bin's stock lock so a `type` or `feedstockTypeId` change can
 * never race a withdrawal: both columns decide which lane every stock
 * derivation reads, so changing them on a bin that still holds material would
 * strand that mass (issue #767). Everything else on a stocked bin, including
 * its name, code and capacity, stays editable.
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

  return db.transaction(async (tx) => {
    // Read before locking: `lockBinStock` reports an archived bin in stock
    // vocabulary, and an edit needs the restore instruction instead.
    await readEditableStorageLocation(ctx, tx, storageLocationId);
    await lockBinStock(ctx, tx, storageLocationId);
    const existing = await readEditableStorageLocation(
      ctx,
      tx,
      storageLocationId,
    );

    // If code is being changed, check for duplicates
    if (data.code && data.code !== existing.code) {
      const [duplicate] = await tx
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(and(eq(storageLocations.code, data.code), eq(storageLocations.organizationId, ctx.organizationId)));

      if (duplicate) {
        throw new SafeError("A storage bin with this code already exists");
      }
    }

    // If facilityId is being changed, verify new facility exists and is active
    if (data.facilityId && data.facilityId !== existing.facilityId) {
      const [facility] = await tx
        .select({ id: facilities.id })
        .from(facilities)
        .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, ctx.organizationId), isNull(facilities.archivedAt)));

      if (!facility) {
        throw new SafeError("Facility not found or archived");
      }
    }

    if (data.feedstockTypeId) {
      const [feedstockType] = await tx
        .select({ id: feedstockTypes.id })
        .from(feedstockTypes)
        .where(and(eq(feedstockTypes.id, data.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)));

      if (!feedstockType) {
        throw new SafeError("Feedstock type not found");
      }
    }

    const effectiveType = data.type ?? existing.type;

    // The Zod update schema can only see the payload. When `type` is omitted it
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

    // A feedstock type only makes sense on a feedstock bin, so clear it
    // when the (effective) type is anything else, same as formulationId below.
    const normalizedFeedstockTypeId = isFeedstockBinType(
      effectiveType as StorageLocationType
    )
      ? effectiveFeedstockTypeId ?? null
      : null;

    // These two columns select the bin's material lane, so a stocked bin keeps
    // the setup its recorded stock and history were written against. The guard
    // compares the two identities itself and returns when neither moved.
    await assertBinIdentityChangeAllowed(
      ctx,
      tx,
      {
        id: storageLocationId,
        type: existing.type as StorageLocationType,
        feedstockTypeId: existing.feedstockTypeId,
      },
      {
        type: effectiveType as StorageLocationType,
        feedstockTypeId: normalizedFeedstockTypeId,
      },
    );

    const normalizedFormulationId =
      effectiveType === "product_bin"
        ? (data.formulationId !== undefined
            ? data.formulationId
            : existing.formulationId) ?? null
        : null;

    if (normalizedFormulationId) {
      const [formulation] = await tx
        .select({ id: formulations.id })
        .from(formulations)
        .where(and(eq(formulations.id, normalizedFormulationId), eq(formulations.organizationId, ctx.organizationId)));

      if (!formulation) {
        throw new SafeError("Formulation not found");
      }
    }

    // Don't let a product bin's formulation be re-pointed while it still holds
    // product of a different formulation, which would dirty the bin. `IS
    // DISTINCT FROM` handles NULL correctly (a pure-biochar product vs a named
    // formulation counts as a mismatch, and vice versa).
    if (effectiveType === "product_bin") {
      const [conflicting] = await tx
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
        tx
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
  });
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

  const blockers = storageLocationBlockers(
    await countStorageLocationReferences(ctx, db, storageLocationId),
  );

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
