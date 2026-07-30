import { SafeError } from "@/lib/errors";

export interface ProductSourceAllocationFact {
  productionRunId: string;
  allocatedWetMassKg: number;
  allocatedDryMassKg: number;
}

interface AllocatableApplication {
  biocharAppliedTons: number;
  biocharAppliedDryTons: number | null;
  biocharProduct: {
    linkedProductionRunId: string;
  };
}

function splitMassByWeights(
  total: number | null,
  weights: number[],
  massLabel: string,
): Array<number | null> {
  if (total == null) return weights.map(() => null);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    if (total === 0) return weights.map(() => 0);
    throw new SafeError(
      `Cannot attribute ${massLabel} across biochar source allocations with zero recorded mass.`,
    );
  }

  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const share = total * (weight / totalWeight);
    remaining -= share;
    return share;
  });
}

/**
 * Project one physical application onto every production lot that supplied its
 * biochar product. Wet and dry mass are conserved independently because source
 * lots can carry different moisture contents.
 *
 * Existing products without allocation rows retain their single legacy run
 * link. Once allocations exist they are authoritative, even if the
 * compatibility link is still populated.
 */
export function splitApplicationAcrossSourceAllocations<
  T extends AllocatableApplication,
>(
  application: T,
  allocations: ProductSourceAllocationFact[],
): Array<T & { sourceAllocation: ProductSourceAllocationFact | null }> {
  if (allocations.length === 0) {
    return [{ ...application, sourceAllocation: null }];
  }

  const sortedAllocations = [...allocations].sort((left, right) =>
    left.productionRunId.localeCompare(right.productionRunId),
  );
  const wetShares = splitMassByWeights(
    application.biocharAppliedTons,
    sortedAllocations.map((allocation) => allocation.allocatedWetMassKg),
    "applied wet mass",
  );
  const dryShares = splitMassByWeights(
    application.biocharAppliedDryTons,
    sortedAllocations.map((allocation) => allocation.allocatedDryMassKg),
    "applied dry mass",
  );

  return sortedAllocations.map((allocation, index) => ({
    ...application,
    biocharAppliedTons: wetShares[index] ?? 0,
    biocharAppliedDryTons: dryShares[index],
    sourceAllocation: allocation,
    biocharProduct: {
      ...application.biocharProduct,
      linkedProductionRunId: allocation.productionRunId,
    },
  }));
}
