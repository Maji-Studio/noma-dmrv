import { and, eq, inArray, isNull, sum } from "drizzle-orm";
import { z } from "zod";
import type { DbTransaction } from "@/db";
import {
  feedstockTypes,
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  storageLocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  MASS_INPUT_MAX_KG,
  MASS_KG_INPUT_STEP,
} from "@/schemas/helpers";
import {
  allocateFeedstockWetMass,
  assertFeedstockWetDrawWithinStock,
} from "../feedstock-wet-stock";
import { assertStockLockSnapshot } from "../lock-bin-stocks";
import { requireOrgScope } from "../utils";

const MASS_PRECISION_FACTOR = 1 / MASS_KG_INPUT_STEP;

export interface ProductionRunFeedstockDrawInput {
  storageLocationId: string;
  wetMassKg: number;
}

/** Validate the data-access boundary independently of action/schema callers. */
export function normalizeProductionRunFeedstockDraws(
  draws: readonly ProductionRunFeedstockDrawInput[],
): ProductionRunFeedstockDrawInput[] {
  const seenStorageLocationIds = new Set<string>();
  let totalMassUnits = 0;

  const normalized = draws.map((draw) => {
    if (!z.uuid().safeParse(draw.storageLocationId).success) {
      throw new SafeError("Choose a valid feedstock source bin");
    }
    if (
      !Number.isFinite(draw.wetMassKg) ||
      draw.wetMassKg <= 0 ||
      draw.wetMassKg > MASS_INPUT_MAX_KG
    ) {
      throw new SafeError("Feedstock draw wet mass must be a positive valid mass");
    }

    const massUnits = Math.round(draw.wetMassKg * MASS_PRECISION_FACTOR);
    if (
      !Number.isSafeInteger(massUnits) ||
      Math.abs(massUnits / MASS_PRECISION_FACTOR - draw.wetMassKg) >
        Number.EPSILON
    ) {
      throw new SafeError("Feedstock draw wet mass must use at most 3 decimal places");
    }
    if (seenStorageLocationIds.has(draw.storageLocationId)) {
      throw new SafeError("Each feedstock source bin can only be used once per run");
    }
    seenStorageLocationIds.add(draw.storageLocationId);
    totalMassUnits += massUnits;
    if (!Number.isSafeInteger(totalMassUnits)) {
      throw new SafeError("Total feedstock wet mass is too large");
    }

    return {
      storageLocationId: draw.storageLocationId,
      wetMassKg: massUnits / MASS_PRECISION_FACTOR,
    };
  });

  if (totalMassUnits / MASS_PRECISION_FACTOR > MASS_INPUT_MAX_KG) {
    throw new SafeError("Total feedstock wet mass is too large");
  }

  return normalized.sort((left, right) =>
    left.storageLocationId.localeCompare(right.storageLocationId),
  );
}

export function sumProductionRunFeedstockDraws(
  draws: readonly ProductionRunFeedstockDrawInput[],
): number {
  return (
    draws.reduce(
      (totalUnits, draw) =>
        totalUnits + Math.round(draw.wetMassKg * MASS_PRECISION_FACTOR),
      0,
    ) / MASS_PRECISION_FACTOR
  );
}

export async function getProductionRunFeedstockDrawStorageIds(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select">,
  productionRunId: string,
): Promise<string[]> {
  requireOrgScope(ctx);
  const rows = await tx
    .select({ storageLocationId: productionRunFeedstockDraws.storageLocationId })
    .from(productionRunFeedstockDraws)
    .where(
      and(
        eq(productionRunFeedstockDraws.productionRunId, productionRunId),
        eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
      ),
    );
  return rows.map((row) => row.storageLocationId).sort();
}

export async function getProductionRunFeedstockDrawTotal(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select">,
  productionRunId: string,
): Promise<number> {
  requireOrgScope(ctx);
  const [row] = await tx
    .select({ total: sum(productionRunFeedstockDraws.wetMassKg) })
    .from(productionRunFeedstockDraws)
    .where(
      and(
        eq(productionRunFeedstockDraws.productionRunId, productionRunId),
        eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
      ),
    );
  return Number(row?.total ?? 0);
}

export function assertProductionRunFeedstockDrawSnapshot(
  beforeLock: readonly string[],
  afterLock: readonly string[],
): void {
  assertStockLockSnapshot(
    beforeLock.length === afterLock.length &&
      beforeLock.every((id, index) => id === afterLock[index]),
  );
}

/** Validate every selected bin while the complete sorted bin-lock set is held. */
export async function validateProductionRunFeedstockDrawSources(
  ctx: OrgContext,
  tx: DbTransaction,
  draws: readonly ProductionRunFeedstockDrawInput[],
  facilityId: string,
): Promise<void> {
  requireOrgScope(ctx);
  if (draws.length === 0) return;

  const locations = await tx
    .select({
      id: storageLocations.id,
      facilityId: storageLocations.facilityId,
      type: storageLocations.type,
      feedstockTypeId: storageLocations.feedstockTypeId,
      feedstockTypeUsage: feedstockTypes.usage,
    })
    .from(storageLocations)
    .leftJoin(
      feedstockTypes,
      and(
        eq(storageLocations.feedstockTypeId, feedstockTypes.id),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(
          storageLocations.id,
          draws.map((draw) => draw.storageLocationId),
        ),
        eq(storageLocations.organizationId, ctx.organizationId),
        isNull(storageLocations.archivedAt),
      ),
    );
  const locationsById = new Map(locations.map((location) => [location.id, location]));

  for (const draw of draws) {
    const location = locationsById.get(draw.storageLocationId);
    if (!location) throw new SafeError("Feedstock storage bin not found or archived");
    if (location.facilityId !== facilityId) {
      throw new SafeError("Feedstock bin does not belong to the selected facility");
    }
    if (location.type !== "feedstock_bin") {
      throw new SafeError("Selected storage bin is not a feedstock bin");
    }
    if (!location.feedstockTypeId || !location.feedstockTypeUsage) {
      throw new SafeError(
        "Source bin must be restricted to a feedstock type before it can feed a production run",
      );
    }
    if (location.feedstockTypeUsage !== "pyrolysis") {
      throw new SafeError(
        "Source bin holds a blend feedstock type and cannot feed a production run",
      );
    }
  }
}

/** Atomically replace bin draws and rebuild batch-level provenance allocations. */
export async function replaceProductionRunFeedstockDraws(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    productionRunId: string;
    facilityId: string;
    draws: readonly ProductionRunFeedstockDrawInput[];
  },
): Promise<number> {
  requireOrgScope(ctx);
  const draws = normalizeProductionRunFeedstockDraws(params.draws);
  await validateProductionRunFeedstockDrawSources(
    ctx,
    tx,
    draws,
    params.facilityId,
  );

  for (const draw of draws) {
    await assertFeedstockWetDrawWithinStock(ctx, tx, {
      storageLocationId: draw.storageLocationId,
      requestedWetKg: draw.wetMassKg,
      excludeRunId: params.productionRunId,
      binLockAlreadyHeld: true,
    });
  }

  await tx.delete(productionRunFeedstocks).where(
    and(
      eq(productionRunFeedstocks.productionRunId, params.productionRunId),
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
    ),
  );
  await tx.delete(productionRunFeedstockDraws).where(
    and(
      eq(productionRunFeedstockDraws.productionRunId, params.productionRunId),
      eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
    ),
  );

  if (draws.length > 0) {
    await tx.insert(productionRunFeedstockDraws).values(
      draws.map((draw) => ({
        organizationId: ctx.organizationId,
        productionRunId: params.productionRunId,
        storageLocationId: draw.storageLocationId,
        wetMassKg: draw.wetMassKg,
      })),
    );
  }

  for (const draw of draws) {
    const allocations = await allocateFeedstockWetMass(
      ctx,
      tx,
      draw.storageLocationId,
      draw.wetMassKg,
    );
    await tx.insert(productionRunFeedstocks).values(
      allocations.map((allocation) => ({
        organizationId: ctx.organizationId,
        productionRunId: params.productionRunId,
        feedstockId: allocation.feedstockId,
        wetMassUsedKg: allocation.wetMassUsedKg,
      })),
    );
  }

  return sumProductionRunFeedstockDraws(draws);
}
