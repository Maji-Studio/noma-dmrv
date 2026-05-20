import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ProductionRunWithSamples } from "./aggregation";

export interface TransportEntityIdsByCategory {
  feedstockIds: string[];
  biocharProductIds: string[];
  sampleIds: string[];
}

export function collectTransportEntityIds(
  lineages: ChainOfCustodyData[],
  runs: ProductionRunWithSamples[],
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

  for (const run of runs) {
    for (const sample of run.samples) {
      sampleIds.add(sample.id);
    }
  }

  return {
    feedstockIds: Array.from(feedstockIds),
    biocharProductIds: Array.from(biocharProductIds),
    sampleIds: Array.from(sampleIds),
  };
}
