import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { CreditBatchDurabilityInput } from "./durability-aggregation";

export interface TransportEntityIdsByCategory {
  feedstockIds: string[];
  biocharProductIds: string[];
  sampleIds: string[];
}

export function collectTransportEntityIds(
  lineages: ChainOfCustodyData[],
  // Sample transport legs hang off the batch-pooled lab Samples (issue #309:
  // a sample anchors on its credit batch, so runs no longer carry them).
  batchesWithSamples: CreditBatchDurabilityInput[],
): TransportEntityIdsByCategory {
  const feedstockIds = new Set<string>();
  const biocharProductIds = new Set<string>();
  const sampleIds = new Set<string>();

  for (const lineage of lineages) {
    if (lineage.biocharProduct) {
      biocharProductIds.add(lineage.biocharProduct.id);
    }
    for (const feedstock of lineage.feedstocks) {
      feedstockIds.add(feedstock.id);
    }
  }

  for (const batch of batchesWithSamples) {
    for (const sample of batch.samples) {
      sampleIds.add(sample.id);
    }
  }

  return {
    feedstockIds: Array.from(feedstockIds),
    biocharProductIds: Array.from(biocharProductIds),
    sampleIds: Array.from(sampleIds),
  };
}
