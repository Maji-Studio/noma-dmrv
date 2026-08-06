import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  binMovements,
  productionRuns,
  storageLocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { computeClampedDryMass } from "@/lib/calculations/mass-dry";
import { SafeError } from "@/lib/errors";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { overdrawError } from "./bin-stock-guards";
import { sourceBiocharMassKgSql } from "./biochar-product-source-mass";
import { requireOrgScope } from "./utils";

const MASS_PRECISION_FACTOR = 1_000;
const MASS_EPSILON_KG = 0.000_001;

export interface AvailableBiocharSourceLot {
  productionRunId: string;
  producedAt: Date;
  availableWetMassKg: number;
  availableDryMassKg: number | null;
  feasibilityWetMassKg?: number;
}

export interface BiocharProductSourceAllocationPlanItem {
  productionRunId: string;
  producedAt: Date;
  allocatedWetMassKg: number;
  allocatedDryMassKg: number;
}

export interface BiocharProductSourceAllocationPlan {
  allocations: BiocharProductSourceAllocationPlanItem[];
  productionDate: Date | null;
  availableWetMassKg: number;
}

export class UnresolvedBiocharDryMassError extends Error {
  constructor(public readonly productionRunId: string) {
    super("Biochar dry mass is unresolved");
    this.name = "UnresolvedBiocharDryMassError";
  }
}

export class InsufficientTraceableBiocharError extends Error {
  constructor(
    public readonly availableWetMassKg: number,
    public readonly requestedWetMassKg: number,
  ) {
    super("Not enough traceable biochar is available");
    this.name = "InsufficientTraceableBiocharError";
  }
}

export class InsufficientSourceDryMassError extends Error {
  constructor(
    public readonly availableDryMassKg: number,
    public readonly requestedDryMassKg: number,
  ) {
    super("Not enough traceable dry biochar is available");
    this.name = "InsufficientSourceDryMassError";
  }
}

function roundMassKg(value: number): number {
  return Math.round(value * MASS_PRECISION_FACTOR) / MASS_PRECISION_FACTOR;
}

function massKgToGrams(value: number, field: string): number {
  const grams = Math.round(value * MASS_PRECISION_FACTOR);
  if (!Number.isSafeInteger(grams)) {
    throw new RangeError(`${field} is too large to allocate safely`);
  }
  return grams;
}

function gramsToMassKg(grams: number): number {
  return grams / MASS_PRECISION_FACTOR;
}

function roundIntegerRatio(
  value: number,
  multiplier: number,
  divisor: number,
): number {
  if (divisor === 0) return 0;
  const divisorBigInt = BigInt(divisor);
  return Number(
    (BigInt(value) * BigInt(multiplier) + divisorBigInt / BigInt(2)) /
      divisorBigInt,
  );
}

/**
 * Divide an integer gram total by weight using largest remainders. Equal
 * remainders keep the caller's order, which is production date then run ID.
 */
function distributeGramsProportionally(
  weights: number[],
  totalGrams: number,
): number[] {
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (!Number.isSafeInteger(totalWeight)) {
    throw new RangeError("Combined source mass is too large to allocate safely");
  }
  if (totalGrams > totalWeight) {
    throw new RangeError("Allocated mass cannot exceed available source mass");
  }
  if (totalWeight === 0 || totalGrams === 0) {
    return weights.map(() => 0);
  }

  const totalWeightBigInt = BigInt(totalWeight);
  const totalGramsBigInt = BigInt(totalGrams);
  const shares = weights.map((weight) =>
    Number((BigInt(weight) * totalGramsBigInt) / totalWeightBigInt),
  );
  const remainders = weights.map((weight, index) => ({
    index,
    remainder:
      (BigInt(weight) * totalGramsBigInt) % totalWeightBigInt,
  }));
  const remainingGrams =
    totalGrams - shares.reduce((total, share) => total + share, 0);

  remainders.sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.index - right.index;
    }
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; index < remainingGrams; index += 1) {
    shares[remainders[index].index] += 1;
  }

  return shares;
}

function assertFiniteNonNegativeMass(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite number at or above 0`);
  }
}

/**
 * Distribute a measured dry draw across lots in proportion to each lot's wet
 * allocation, capped by what each lot can physically supply. Overflow past a
 * capped lot re-spreads across the remaining lots by the same wet weights.
 * The caller must ensure `totalGrams` does not exceed the summed caps.
 */
function distributeDryGramsWithinCaps(
  wetWeights: number[],
  caps: number[],
  totalGrams: number,
): number[] {
  const shares = wetWeights.map(() => 0);
  let remainingGrams = totalGrams;

  while (remainingGrams > 0) {
    const roundWeights = wetWeights.map((weight, index) =>
      shares[index] < caps[index] ? weight : 0,
    );
    const roundWeightTotal = roundWeights.reduce(
      (total, weight) => total + weight,
      0,
    );
    if (roundWeightTotal === 0) {
      throw new RangeError(
        "Requested dry mass cannot exceed the lots' dry capacity",
      );
    }
    const grants = distributeGramsProportionally(
      roundWeights,
      Math.min(remainingGrams, roundWeightTotal),
    );
    grants.forEach((grant, index) => {
      const applied = Math.min(grant, caps[index] - shares[index]);
      shares[index] += applied;
      remainingGrams -= applied;
    });
  }

  return shares;
}

/**
 * Allocate a source-bin draw across every traceable production lot in
 * proportion to its remaining wet mass.
 *
 * Documented losses are first spread across the same lots by mass. All
 * apportionment happens in integer grams, so the allocation rows sum exactly to
 * the requested wet mass while retaining deterministic production-date/run-ID
 * tie-breaking. Positive reconciliation movements are intentionally excluded
 * by the caller: without a production-run source they cannot safely acquire
 * certified provenance.
 *
 * `requestedDryMassKg` is the freshly measured dry mass of the draw (wet draw
 * at the operator's entered moisture). When provided it is the authoritative
 * dry withdrawal, spread across lots by wet allocation and capped by each
 * lot's remaining dry mass. When null, each lot's dry draw falls back to its
 * recorded wet/dry ratio.
 */
export function planBiocharProductSourceAllocations(
  lots: AvailableBiocharSourceLot[],
  requestedWetMassKg: number,
  documentedLossWetMassKg = 0,
  requestedDryMassKg: number | null = null,
): BiocharProductSourceAllocationPlan {
  assertFiniteNonNegativeMass(requestedWetMassKg, "requestedWetMassKg");
  assertFiniteNonNegativeMass(
    documentedLossWetMassKg,
    "documentedLossWetMassKg",
  );
  if (requestedDryMassKg != null) {
    assertFiniteNonNegativeMass(requestedDryMassKg, "requestedDryMassKg");
    if (requestedDryMassKg > requestedWetMassKg) {
      throw new RangeError(
        "requestedDryMassKg cannot exceed requestedWetMassKg",
      );
    }
  }

  const orderedLots = [...lots]
    .map((lot) => {
      assertFiniteNonNegativeMass(
        lot.availableWetMassKg,
        "availableWetMassKg",
      );
      if (lot.availableDryMassKg != null) {
        assertFiniteNonNegativeMass(
          lot.availableDryMassKg,
          "availableDryMassKg",
        );
      }
      if (
        lot.feasibilityWetMassKg != null &&
        !Number.isFinite(lot.feasibilityWetMassKg)
      ) {
        throw new RangeError(
          "feasibilityWetMassKg must be a finite number",
        );
      }
      return { ...lot };
    })
    .sort(
      (left, right) =>
        left.producedAt.getTime() - right.producedAt.getTime() ||
        left.productionRunId.localeCompare(right.productionRunId),
    );

  const preparedLots = orderedLots.map((lot) => ({
    ...lot,
    wetMassGrams: massKgToGrams(
      lot.availableWetMassKg,
      "availableWetMassKg",
    ),
    dryMassGrams:
      lot.availableDryMassKg == null
        ? null
        : massKgToGrams(lot.availableDryMassKg, "availableDryMassKg"),
    feasibilityWetMassGrams: massKgToGrams(
      lot.feasibilityWetMassKg ?? lot.availableWetMassKg,
      "feasibilityWetMassKg",
    ),
  }));
  const totalWetMassGrams = preparedLots.reduce(
    (total, lot) => total + lot.wetMassGrams,
    0,
  );
  const recordedLossGrams = massKgToGrams(
    documentedLossWetMassKg,
    "documentedLossWetMassKg",
  );
  const drawableLossGrams = Math.min(
    recordedLossGrams,
    totalWetMassGrams,
  );
  const lossByLotGrams = distributeGramsProportionally(
    preparedLots.map((lot) => lot.wetMassGrams),
    drawableLossGrams,
  );
  const availableLots = preparedLots.map((lot, index) => {
    const availableWetMassGrams =
      lot.wetMassGrams - lossByLotGrams[index];
    const availableDryMassGrams =
      lot.dryMassGrams == null
        ? null
        : roundIntegerRatio(
            lot.dryMassGrams,
            availableWetMassGrams,
            lot.wetMassGrams,
          );
    return {
      ...lot,
      availableWetMassGrams,
      availableDryMassGrams,
    };
  });
  const availableWetMassGrams =
    preparedLots.reduce(
      (total, lot) => total + lot.feasibilityWetMassGrams,
      0,
    ) - recordedLossGrams;
  const availableWetMassKg = gramsToMassKg(availableWetMassGrams);
  const requestedWetMassGrams = massKgToGrams(
    requestedWetMassKg,
    "requestedWetMassKg",
  );
  const roundedRequestedWetMassKg = gramsToMassKg(requestedWetMassGrams);

  if (requestedWetMassGrams > availableWetMassGrams) {
    throw new InsufficientTraceableBiocharError(
      availableWetMassKg,
      roundedRequestedWetMassKg,
    );
  }

  if (requestedWetMassGrams === 0) {
    return {
      allocations: [],
      productionDate: null,
      availableWetMassKg,
    };
  }

  const allocatedWetMassByLotGrams = distributeGramsProportionally(
    availableLots.map((lot) => lot.availableWetMassGrams),
    requestedWetMassGrams,
  );

  let measuredDryMassByLotGrams: number[] | null = null;
  if (requestedDryMassKg != null) {
    const requestedDryMassGrams = massKgToGrams(
      requestedDryMassKg,
      "requestedDryMassKg",
    );
    const dryCapsGrams = availableLots.map((lot, index) => {
      const allocatedWetMassGrams = allocatedWetMassByLotGrams[index];
      if (allocatedWetMassGrams === 0) return 0;
      if (lot.availableDryMassGrams == null) {
        throw new UnresolvedBiocharDryMassError(lot.productionRunId);
      }
      return Math.min(lot.availableDryMassGrams, allocatedWetMassGrams);
    });
    const dryCapacityGrams = dryCapsGrams.reduce(
      (total, cap) => total + cap,
      0,
    );
    if (requestedDryMassGrams > dryCapacityGrams) {
      throw new InsufficientSourceDryMassError(
        gramsToMassKg(dryCapacityGrams),
        gramsToMassKg(requestedDryMassGrams),
      );
    }
    measuredDryMassByLotGrams = distributeDryGramsWithinCaps(
      allocatedWetMassByLotGrams,
      dryCapsGrams,
      requestedDryMassGrams,
    );
  }

  const allocations = availableLots.flatMap(
    (lot, index): BiocharProductSourceAllocationPlanItem[] => {
      const allocatedWetMassGrams =
        allocatedWetMassByLotGrams[index];
      if (allocatedWetMassGrams === 0) return [];

      let allocatedDryMassGrams: number;
      if (measuredDryMassByLotGrams) {
        allocatedDryMassGrams = measuredDryMassByLotGrams[index];
      } else {
        const availableDryMassGrams = lot.availableDryMassGrams;
        if (availableDryMassGrams == null) {
          throw new UnresolvedBiocharDryMassError(lot.productionRunId);
        }
        allocatedDryMassGrams = Math.min(
          availableDryMassGrams,
          roundIntegerRatio(
            availableDryMassGrams,
            allocatedWetMassGrams,
            lot.availableWetMassGrams,
          ),
        );
      }

      return [{
        productionRunId: lot.productionRunId,
        producedAt: lot.producedAt,
        allocatedWetMassKg: gramsToMassKg(allocatedWetMassGrams),
        allocatedDryMassKg: gramsToMassKg(allocatedDryMassGrams),
      }];
    },
  );

  return {
    allocations,
    productionDate: allocations[0]?.producedAt ?? null,
    availableWetMassKg,
  };
}

/**
 * Resolve a source-bin draw to immutable production-run lots.
 *
 * The caller must already hold the source bin's advisory stock lock.
 */
export async function buildBiocharProductSourceAllocationPlan(
  ctx: OrgContext,
  tx: DbTransaction,
  input: {
    sourceStorageLocationId: string;
    facilityId: string;
    requestedWetMassKg: number;
    /** Measured dry mass of the draw at the operator's entered moisture. */
    requestedDryMassKg?: number | null;
  },
): Promise<BiocharProductSourceAllocationPlan> {
  requireOrgScope(ctx);

  const [[sourceStorage], runRows, allocationRows, legacyProductRows, [lossRow]] =
    await Promise.all([
      tx
        .select({
          id: storageLocations.id,
          facilityId: storageLocations.facilityId,
          type: storageLocations.type,
        })
        .from(storageLocations)
        .where(
          and(
            eq(storageLocations.id, input.sourceStorageLocationId),
            eq(storageLocations.organizationId, ctx.organizationId),
            isNull(storageLocations.archivedAt),
          ),
        ),
      tx
        .select({
          id: productionRuns.id,
          producedAt: productionRuns.startTime,
          wetMassKg: productionRuns.biocharOutputKg,
          dryMassKg: productionRuns.biocharDryMassKg,
          moisturePercent: productionRuns.biocharMoisturePercent,
        })
        .from(productionRuns)
        .where(
          and(
            eq(
              productionRuns.biocharStorageLocationId,
              input.sourceStorageLocationId,
            ),
            eq(productionRuns.organizationId, ctx.organizationId),
            eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
          ),
        )
        .orderBy(asc(productionRuns.startTime), asc(productionRuns.id)),
      tx
        .select({
          productionRunId:
            biocharProductSourceAllocations.productionRunId,
          allocatedWetMassKg: sumNumeric(
            biocharProductSourceAllocations.allocatedWetMassKg,
          ),
          allocatedDryMassKg: sumNumeric(
            biocharProductSourceAllocations.allocatedDryMassKg,
          ),
        })
        .from(biocharProductSourceAllocations)
        .where(
          and(
            eq(
              biocharProductSourceAllocations.sourceStorageLocationId,
              input.sourceStorageLocationId,
            ),
            eq(
              biocharProductSourceAllocations.organizationId,
              ctx.organizationId,
            ),
          ),
        )
        .groupBy(biocharProductSourceAllocations.productionRunId),
      tx
        .select({
          productionRunId: biocharProducts.linkedProductionRunId,
          allocatedWetMassKg: sumNumeric(
            sourceBiocharMassKgSql(
              biocharProducts.massKg,
              biocharProducts.composition,
            ),
          ),
        })
        .from(biocharProducts)
        .innerJoin(
          productionRuns,
          and(
            eq(
              biocharProducts.linkedProductionRunId,
              productionRuns.id,
            ),
            eq(productionRuns.organizationId, ctx.organizationId),
          ),
        )
        .where(
          and(
            eq(
              productionRuns.biocharStorageLocationId,
              input.sourceStorageLocationId,
            ),
            eq(biocharProducts.organizationId, ctx.organizationId),
            isNull(biocharProducts.sourceBiocharStorageLocationId),
          ),
        )
        .groupBy(biocharProducts.linkedProductionRunId),
      tx
        .select({
          wetMassKg: sumNumeric(
            sql`-${binMovements.massDeltaKg}`,
            lt(binMovements.massDeltaKg, 0),
          ),
        })
        .from(binMovements)
        .where(
          and(
            eq(
              binMovements.storageLocationId,
              input.sourceStorageLocationId,
            ),
            eq(binMovements.organizationId, ctx.organizationId),
            eq(binMovements.lane, "biochar"),
          ),
        ),
    ]);

  if (!sourceStorage) {
    throw new SafeError("Source biochar bin not found or archived");
  }
  if (sourceStorage.facilityId !== input.facilityId) {
    throw new SafeError("Source biochar bin belongs to a different facility");
  }
  if (sourceStorage.type !== "biochar_bin") {
    throw new SafeError("Source must be a biochar bin");
  }

  const allocationsByRun = new Map(
    allocationRows.map((row) => [row.productionRunId, row]),
  );
  const legacyWetByRun = new Map(
    legacyProductRows.flatMap((row) =>
      row.productionRunId
        ? [[row.productionRunId, row.allocatedWetMassKg] as const]
        : [],
    ),
  );

  const lots: AvailableBiocharSourceLot[] = runRows.flatMap((run) => {
    const wetMassKg = run.wetMassKg ?? 0;
    const legacyAllocatedWetMassKg = legacyWetByRun.get(run.id) ?? 0;
    const allocation = allocationsByRun.get(run.id);
    const allocatedWetMassKg =
      legacyAllocatedWetMassKg + (allocation?.allocatedWetMassKg ?? 0);
    if (
      wetMassKg <= MASS_EPSILON_KG &&
      allocatedWetMassKg <= MASS_EPSILON_KG
    ) {
      return [];
    }
    const dryMassKg =
      run.dryMassKg ??
      computeClampedDryMass(wetMassKg, run.moisturePercent);
    const legacyAllocatedDryMassKg =
      dryMassKg == null || wetMassKg === 0
        ? null
        : legacyAllocatedWetMassKg * (dryMassKg / wetMassKg);
    const allocatedDryMassKg =
      legacyAllocatedDryMassKg == null
        ? null
        : legacyAllocatedDryMassKg +
          (allocation?.allocatedDryMassKg ?? 0);
    const availableWetMassKg = roundMassKg(
      Math.max(0, wetMassKg - allocatedWetMassKg),
    );
    const feasibilityWetMassKg = roundMassKg(
      wetMassKg - allocatedWetMassKg,
    );
    const availableDryMassKg =
      dryMassKg == null || allocatedDryMassKg == null
        ? null
        : roundMassKg(Math.max(0, dryMassKg - allocatedDryMassKg));

    return [{
      productionRunId: run.id,
      producedAt: run.producedAt,
      availableWetMassKg,
      availableDryMassKg,
      feasibilityWetMassKg,
    }];
  });

  try {
    return planBiocharProductSourceAllocations(
      lots,
      input.requestedWetMassKg,
      lossRow?.wetMassKg ?? 0,
      input.requestedDryMassKg ?? null,
    );
  } catch (error) {
    if (error instanceof InsufficientTraceableBiocharError) {
      throw overdrawError("biochar");
    }
    if (error instanceof InsufficientSourceDryMassError) {
      throw new SafeError(
        `The entered biochar moisture needs ${error.requestedDryMassKg} kg of dry biochar, but the source bin holds ${error.availableDryMassKg} kg. Increase the moisture or reduce the blend mass.`,
      );
    }
    if (error instanceof UnresolvedBiocharDryMassError) {
      throw new SafeError(
        "Dry mass is missing for biochar in this bin. Record the source run's wet mass and moisture before creating a product.",
      );
    }
    throw error;
  }
}

export async function insertBiocharProductSourceAllocations(
  ctx: OrgContext,
  tx: DbTransaction,
  input: {
    biocharProductId: string;
    sourceStorageLocationId: string;
    allocations: BiocharProductSourceAllocationPlanItem[];
  },
): Promise<void> {
  requireOrgScope(ctx);
  if (input.allocations.length === 0) return;

  await tx.insert(biocharProductSourceAllocations).values(
    input.allocations.map((allocation) => ({
      organizationId: ctx.organizationId,
      biocharProductId: input.biocharProductId,
      productionRunId: allocation.productionRunId,
      sourceStorageLocationId: input.sourceStorageLocationId,
      allocatedWetMassKg: allocation.allocatedWetMassKg,
      allocatedDryMassKg: allocation.allocatedDryMassKg,
    })),
  );
}
