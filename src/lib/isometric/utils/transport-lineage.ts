type TransportLineageInput = {
  feedstocks: Array<{ id: string; ownsTransport: boolean }>;
  biocharProduct: { id: string } | null;
  products?: Array<{ product: { id: string } }>;
};

export interface TransportEntityIdsByCategory {
  feedstockIds: string[];
  biocharProductIds: string[];
  sampleIds: string[];
}

export function collectTransportEntityIds(
  lineages: TransportLineageInput[],
): TransportEntityIdsByCategory {
  const feedstockIds = new Set<string>();
  const biocharProductIds = new Set<string>();

  for (const lineage of lineages) {
    for (const product of lineage.products?.map(p => p.product) ?? (lineage.biocharProduct ? [lineage.biocharProduct] : [])) {
      biocharProductIds.add(product.id);
    }
    for (const feedstock of lineage.feedstocks) {
      if (feedstock.ownsTransport) feedstockIds.add(feedstock.id);
    }
  }

  return {
    feedstockIds: Array.from(feedstockIds),
    biocharProductIds: Array.from(biocharProductIds),
    sampleIds: [],
  };
}
