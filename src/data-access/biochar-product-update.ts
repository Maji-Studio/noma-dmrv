import { readRecordDependents } from "./record-lock-dependents";
import { assertRecordLockFields } from "@/lib/record-lock-fields";
import { recordLocks } from "@/lib/record-lock";
import type { CaptureActivity } from "@/lib/activity-changes";
import { db, type DbTransaction } from "@/db";
import { biocharProducts, type BiocharProduct } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { and, eq } from "drizzle-orm";
import { compositionAllocationChanged } from "./biochar-product-composition";
import { assertCanMutateCertifiedLineage } from "./certification-lineage-guards";
import { CODE_CONFLICT_MESSAGES, withUniqueCodeGuard } from "./code-generator";
import { lockBinStocks } from "./lock-bin-stocks";
import { assertRowVersion, nextVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const PRODUCT_NOT_FOUND_MESSAGE = "Biochar product not found";
const IMMUTABLE_POSTING_MESSAGE = "Posted product source, composition, placement, and bin are immutable. Use an explicit stock correction.";
const IMMUTABLE_INGREDIENTS_MESSAGE = "Posted ingredient moisture and dry solids are immutable.";
/** Facts a posted product's stock was drawn on. An edit form may resend them unchanged; changing one is refused. */
const POSTED_FIELDS = ["facilityId", "formulationId", "linkedProductionRunId", "storageLocationId", "massKg", "moistureContentPercent", "waterAddedKg"] as const;

export interface UpdateBiocharProductInput {
  expectedVersion: number;
  code?: string;
  status?: "draft" | "testing" | "ready" | "sold";
  /** Null clears the density; omitted leaves it. */
  densityKgM3?: number | null;
  facilityId?: string;
  formulationId?: string | null;
  placedAt?: string;
  linkedProductionRunId?: string | null;
  storageLocationId?: string | null;
  massKg?: number | null;
  moistureContentPercent?: number | null;
  waterAddedKg?: number | null;
  composition?: Record<string, unknown>;
}

function productNotFound(): DomainError {
  return new DomainError("not_found", PRODUCT_NOT_FOUND_MESSAGE, {
    issues: [{ path: ["biocharProductId"], code: "not_found", message: PRODUCT_NOT_FOUND_MESSAGE }],
  });
}

/**
 * Edits a posted product inside the caller's transaction. Only `code`,
 * `status` and `densityKgM3` are written; the facts its stock was drawn on are
 * immutable. Lock order as every product writer: bins, certification lineage
 * (refused as `certification_locked`), then the product row for the version check.
 */
export async function updateBiocharProductInTransaction(ctx: OrgContext, tx: DbTransaction, productId: string, data: UpdateBiocharProductInput, capture?: CaptureActivity): Promise<BiocharProduct> {
  requireOrgScope(ctx);
  const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId)));
  if (!product) throw productNotFound();
  await lockBinStocks(ctx, tx, [product.storageLocationId, product.sourceBiocharStorageLocationId]);
  // Application allocation FKs take product KEY SHARE after artifact locks.
  await withFeedstockErrors(() => assertCanMutateCertifiedLineage(ctx, tx, { entityType: "biocharProduct", entityId: productId }, "update"), "certification_locked");
  const [locked] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId))).for("update");
  if (!locked) throw productNotFound();
  assertRowVersion({ entity: "biocharProduct", id: productId, expectedVersion: data.expectedVersion, actualVersion: locked.version });
  assertRecordLockFields(recordLocks.biocharProduct({ removals: [], dependents: await readRecordDependents(ctx, tx, { entityType: "biocharProduct", entityId: productId }) }), locked, Object.fromEntries(Object.entries(data).filter(([key]) => key !== "expectedVersion")), IMMUTABLE_POSTING_MESSAGE);
  const placementChanged = data.placedAt !== undefined && new Date(data.placedAt).getTime() !== product.placedAt.getTime();
  if (placementChanged || POSTED_FIELDS.some(key => data[key] !== undefined && data[key] !== product[key])) throw new SafeError(IMMUTABLE_POSTING_MESSAGE);
  if (data.composition && compositionAllocationChanged(product.composition as Record<string, unknown>, data.composition)) throw new SafeError(IMMUTABLE_INGREDIENTS_MESSAGE);
  const [saved] = await withUniqueCodeGuard(ctx, biocharProducts, biocharProducts.code, CODE_CONFLICT_MESSAGES.biocharProduct, () => tx.update(biocharProducts)
    .set({ version: nextVersion(biocharProducts.version), code: data.code, status: data.status, densityKgM3: data.densityKgM3, updatedAt: new Date() })
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId))).returning());
  capture?.(productId, locked, saved);
  return saved;
}

/** `updateBiocharProductInTransaction` in a transaction of its own, without the operation runner. */
export async function updateBiocharProduct(ctx: OrgContext, productId: string, data: UpdateBiocharProductInput): Promise<BiocharProduct> {
  requireOrgScope(ctx);
  return db.transaction(tx => updateBiocharProductInTransaction(ctx, tx, productId, data));
}
