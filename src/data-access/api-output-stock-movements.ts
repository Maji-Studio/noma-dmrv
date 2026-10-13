import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, outputStockAllocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { requireOrgScope, type Executor } from "./utils";
import { findApiStorageLocation } from "./api-storage-locations";
import { lookupCursorCreatedAt, type ApiLookupIdentifier, type ApiLookupPosition } from "./api-lookup-filters";

const OUTPUT_LANES = ["biochar", "product"] as const;
const FEEDSTOCK_BIN_MESSAGE = "Stock movements are recorded on biochar and product bins. Feedstock bin stock is read from the feedstock records.";

/** One id per distinct layer or link of the movement, in id order. Raw columns stay qualified. */
function allocationIds(ctx: OrgContext, column: "production_run_id" | "biochar_product_id") {
  return sql<string[]>`(
    select coalesce(json_agg(effect.${sql.raw(column)} order by effect.${sql.raw(column)}), '[]'::json)
    from ${outputStockAllocations} as effect
    where effect.organization_id = ${ctx.organizationId}
      and effect.movement_id = "bin_movements"."id"
      and effect.organization_id = "bin_movements"."organization_id"
      and effect.${sql.raw(column)} is not null
  )`;
}
function allocationLink(ctx: OrgContext, column: "delivery_id" | "target_biochar_product_id") {
  return sql<string | null>`(
    select min(effect.${sql.raw(column)}::text)
    from ${outputStockAllocations} as effect
    where effect.organization_id = ${ctx.organizationId}
      and effect.movement_id = "bin_movements"."id"
      and effect.organization_id = "bin_movements"."organization_id"
  )`;
}

/** The output bin whose history is read: foreign is 404, a feedstock bin is a 422. */
export async function requireApiOutputBin(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const bin = await findApiStorageLocation(ctx, identifier);
  if (bin.type === "feedstock_bin") throw new DomainError("validation_failed", FEEDSTOCK_BIN_MESSAGE, {
    issues: [{ path: ["storageLocationId"], code: "validation_failed", message: FEEDSTOCK_BIN_MESSAGE }],
  });
  return bin;
}

/** The published movement columns; raw subquery columns stay qualified so the correlation cannot bind locally. */
function movementFields(ctx: OrgContext) {
  return {
    id: binMovements.id,
    storageLocationId: binMovements.storageLocationId,
    kind: binMovements.outputKind,
    occurredAt: binMovements.occurredAt,
    // A reversal copies the corrected movement's snapshot, so it publishes no measurement of its own.
    wetMassKg: sql<number | null>`case when "bin_movements"."output_kind" = 'reversal' then null else "bin_movements"."input_snapshot"->'wetMassKg' end`,
    moisturePercent: sql<number | null>`case when "bin_movements"."output_kind" = 'reversal' then null else "bin_movements"."input_snapshot"->'moisturePercent' end`,
    dryDeltaKg: binMovements.outputDryDeltaKg,
    balanceBeforeDryKg: binMovements.balanceBeforeDryKg,
    balanceAfterDryKg: binMovements.balanceAfterDryKg,
    reason: binMovements.reason,
    correctsMovementId: binMovements.correctsMovementId,
    correctedByMovementId: sql<string | null>`(
      select min(correction.id::text)
      from ${binMovements} as correction
      where correction.organization_id = ${ctx.organizationId}
        and correction.corrects_movement_id = "bin_movements"."id"
        and correction.output_kind = 'reversal'
        and correction.organization_id = "bin_movements"."organization_id"
    )`,
    productionRunIds: allocationIds(ctx, "production_run_id"),
    biocharProductIds: allocationIds(ctx, "biochar_product_id"),
    targetBiocharProductId: allocationLink(ctx, "target_biochar_product_id"),
    deliveryId: allocationLink(ctx, "delivery_id"),
    createdAt: binMovements.createdAt,
    cursorCreatedAt: lookupCursorCreatedAt(binMovements.createdAt),
  };
}

/**
 * Newest posting first by posting sequence, a bigserial that never repeats and
 * grows with every commit order of the ledger. The cursor's id resolves to its
 * sequence inside the statement, so the page boundary needs no timestamp.
 */
export async function listApiOutputStockMovements(
  ctx: OrgContext, filters: { storageLocationId: string }, limit: number, cursor?: ApiLookupPosition,
) {
  requireOrgScope(ctx);
  const bin = await requireApiOutputBin(ctx, { id: filters.storageLocationId });
  return db.select(movementFields(ctx)).from(binMovements).where(and(
    eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, bin.id),
    inArray(binMovements.lane, OUTPUT_LANES), isNotNull(binMovements.outputKind),
    cursor ? sql`"bin_movements"."posting_sequence" < (
      select earlier.posting_sequence from ${binMovements} as earlier
      where earlier.id = ${cursor.id}::uuid and earlier.organization_id = ${ctx.organizationId} and earlier.storage_location_id = ${bin.id}
    )` : undefined,
  )).orderBy(desc(binMovements.postingSequence)).limit(limit + 1);
}

/** One output movement by id, read in the write transaction that posted it. */
export async function findApiOutputStockMovement(ctx: OrgContext, movementId: string, executor: Executor = db) {
  requireOrgScope(ctx);
  const [row] = await executor.select(movementFields(ctx)).from(binMovements).where(and(
    eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.id, movementId),
    inArray(binMovements.lane, OUTPUT_LANES), isNotNull(binMovements.outputKind),
  )).limit(1);
  if (!row) throw new DomainError("not_found", "Movement was not found.");
  return row;
}
