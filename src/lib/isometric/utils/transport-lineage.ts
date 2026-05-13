/**
 * Transport lineage utilities
 *
 * Pure helpers that walk pre-fetched credit-batch lineage data and runs to
 * extract the per-category entity IDs that transport legs may attach to.
 * No DB calls; consumers (submit-credit-batch.ts, certify-context.ts) feed
 * the IDs to `getTransportLegsForEntities` to fetch the actual legs.
 */

import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ProductionRunWithSamples } from "./aggregation";

export interface TransportEntityIdsByCategory {
  feedstockIds: string[];
  biocharProductIds: string[];
  sampleIds: string[];
}

/**
 * Walk every application's lineage + the loaded production runs and return
 * the deduped entity IDs that each transport-leg category should fetch.
 *
 * - `feedstockIds` — feedstocks consumed by any run upstream of any
 *   application in the credit batch (`feedstocks.id`).
 * - `biocharProductIds` — biochar products linked to the lineage via the
 *   delivery → order fallback (`biochar_products.id`).
 * - `sampleIds` — samples attached to any of the runs (`samples.id`).
 */
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
