import type {
  ChainOfCustodyData,
  ChainSourceLineage,
} from "@/data-access/chain-of-custody";

interface SourceChain<Run, Feedstock, Reactor> {
  productionRun: Run | null;
  feedstocks: Feedstock[];
  reactor?: Reactor;
  sources?: {
    productionRun: Run;
    feedstocks: Feedstock[];
    reactor?: Reactor;
    allocatedWetMassKg?: number | null;
    allocatedDryMassKg?: number | null;
  }[];
}

/** Normalize allocation-backed and legacy single-run chain payloads. */
export function resolveChainSources(
  chain: Pick<
    ChainOfCustodyData,
    "sources" | "productionRun" | "reactor" | "feedstocks"
  >,
): ChainSourceLineage[];
/** Also accept the narrow structural records used by pure mass builders. */
export function resolveChainSources<Run, Feedstock, Reactor>(
  chain: SourceChain<Run, Feedstock, Reactor>,
): NonNullable<SourceChain<Run, Feedstock, Reactor>["sources"]>;
export function resolveChainSources<Run, Feedstock, Reactor>(
  chain: SourceChain<Run, Feedstock, Reactor>,
): NonNullable<SourceChain<Run, Feedstock, Reactor>["sources"]> {
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
