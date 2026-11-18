import type {
  BatchLineageApplicationFact,
  BatchLineageRunFact,
  CreditBatchLineageFacts,
} from "@/data-access/credit-batch-lineage-types";
import type { DashboardBatchScope } from "@/data-access/dashboard-batch-scope";
import { kgToTonnes } from "./calculations/unit-conversions";
import { sumNullable, sumNullableBy } from "./nullable-sum";

export interface DashboardBatchScopeFacts {
  lineageFacts: CreditBatchLineageFacts;
  co2eStoredTonnes: number | null;
}

/**
 * The graph's record union without constructing presentation nodes. Runs keep
 * their first occurrence, like deduping nodes by id. An application's dry mass
 * on a batch's facts is that batch's slice of it, so applied mass sums every
 * batch's slices while the application itself counts once.
 */
export function projectDashboardBatchScope(
  batches: readonly DashboardBatchScopeFacts[],
): Omit<DashboardBatchScope, "activity" | "downstreamComplete"> {
  const batchIds = new Set<string>();
  const recordIds = new Set<string>();
  const suppliers = new Set<string>();
  const feedstocks = new Set<string>();
  const runs = new Map<string, BatchLineageRunFact>();
  const products = new Set<string>();
  const deliveries = new Set<string>();
  const applications = new Set<string>();
  const appliedSlices: BatchLineageApplicationFact[] = [];
  const estimates: (number | null)[] = [];

  for (const { lineageFacts: facts, co2eStoredTonnes } of batches) {
    if (batchIds.has(facts.batchId)) continue;
    batchIds.add(facts.batchId);
    recordIds.add(facts.batchId);
    estimates.push(co2eStoredTonnes);
    for (const run of facts.runs) {
      if (!runs.has(run.id)) runs.set(run.id, run);
      recordIds.add(run.id);
      if (run.reactor) recordIds.add(run.reactor.id);
      for (const feedstock of run.feedstocks) {
        feedstocks.add(feedstock.id);
        recordIds.add(feedstock.id);
        if (feedstock.supplierId) suppliers.add(`id:${feedstock.supplierId}`);
        else if (feedstock.supplierName) suppliers.add(`name:${feedstock.supplierName}`);
      }
      for (const product of facts.runForwards?.[run.id] ?? []) {
        products.add(product.id);
        recordIds.add(product.id);
        for (const delivery of product.deliveries) {
          deliveries.add(delivery.id);
          recordIds.add(delivery.id);
        }
      }
    }
    for (const application of facts.applications) {
      applications.add(application.id);
      appliedSlices.push(application);
      products.add(application.biocharProduct.id);
      deliveries.add(application.delivery.id);
      recordIds.add(application.id);
      recordIds.add(application.biocharProduct.id);
      recordIds.add(application.delivery.id);
      if (application.order) recordIds.add(application.order.id);
    }
  }

  const feedstockKg = sumNullableBy([...runs.values()], (run) => run.feedstockMassDryKg);
  const biocharKg = sumNullableBy([...runs.values()], (run) => run.biocharDryMassKg);
  return {
    batchIds: [...batchIds],
    stationTotals: {
      suppliers: suppliers.size,
      feedstock: feedstocks.size,
      production: runs.size,
      products: products.size,
      deliveries: deliveries.size,
      applications: applications.size,
    },
    kpis: {
      feedstockProcessedDryTonnes: feedstockKg === null ? null : kgToTonnes(feedstockKg),
      biocharProducedDryTonnes: biocharKg === null ? null : kgToTonnes(biocharKg),
      appliedToSoilDryTonnes: applications.size === 0
        ? 0
        : sumNullableBy(appliedSlices, (slice) => slice.biocharAppliedDryTons),
      co2eStoredTonnes: estimates.every((estimate) => estimate !== null)
        ? sumNullable(estimates)
        : null,
    },
    recordIds: [...recordIds].sort(),
  };
}
