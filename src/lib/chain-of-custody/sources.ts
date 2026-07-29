import type {
  ChainOfCustodyData,
  ChainSourceLineage,
} from "@/data-access/chain-of-custody";

/** Normalize allocation-backed and legacy single-run chain payloads. */
export function resolveChainSources(
  chain: Pick<
    ChainOfCustodyData,
    "sources" | "productionRun" | "reactor" | "feedstocks"
  >,
): ChainSourceLineage[] {
  if (chain.sources && chain.sources.length > 0) {
    return chain.sources;
  }
  return chain.productionRun
    ? [
        {
          productionRun: chain.productionRun,
          reactor: chain.reactor,
          feedstocks: chain.feedstocks,
          allocatedWetMassKg: null,
          allocatedDryMassKg: null,
        },
      ]
    : [];
}
