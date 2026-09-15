import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";

/** Separate product branches while retaining physical delivery/application IDs. */
export function expandProductLineages(chain: ChainOfCustodyData): ChainOfCustodyData[] {
  if (!chain.products?.length) return [chain];
  return chain.products.map(({ product, sources, allocatedWetMassKg, allocatedDryMassKg }) => ({
    ...chain, products: undefined, biocharProduct: product, sources,
    productionRun: sources.length === 1 ? sources[0].productionRun : null,
    reactor: sources.length === 1 ? sources[0].reactor : null,
    feedstocks: [...new Map(sources.flatMap(s => s.feedstocks).map(f => [f.id, f])).values()],
    application: { ...chain.application, biocharAppliedTons: allocatedWetMassKg / KG_PER_TONNE, biocharAppliedDryTons: allocatedDryMassKg / KG_PER_TONNE },
  }));
}
