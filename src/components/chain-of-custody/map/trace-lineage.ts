/**
 * The records an application was actually supplied from, read from its own
 * lineage (not the merged batch graph, where one delivery carrying several
 * products would credit every field with every product).
 */
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { resolveChainSources } from "@/lib/chain-of-custody/sources";
import {
  applicationNodeId,
  deliveryNodeId,
  productNodeId,
  productionRunNodeId,
} from "@/lib/chain-of-custody/lineage-mass-totals";
import { expandProductLineages } from "../expand-product-lineages";

/** Graph node ids of the application, its delivery and order, its products, their runs and intakes. */
export function lineageRecordIds(data: ChainOfCustodyData): Set<string> {
  const ids = new Set<string>([applicationNodeId(data.application.id), deliveryNodeId(data.delivery.id)]);
  if (data.order) ids.add(`order:${data.order.id}`);
  for (const slice of expandProductLineages(data)) {
    if (slice.biocharProduct) ids.add(productNodeId(slice.biocharProduct.id));
    for (const source of resolveChainSources(slice)) {
      ids.add(productionRunNodeId(source.productionRun.id));
      for (const feedstock of source.feedstocks) ids.add(`feedstock:${feedstock.id}`);
    }
  }
  return ids;
}

/**
 * Each application's lineage record ids, by the application's graph node id.
 * The batch sends one lineage per product slice, so an application that drew
 * from two products arrives twice: its slices are unioned.
 */
export function lineageIdsByApplication(lineages: ChainOfCustodyData[]): Map<string, Set<string>> {
  const byApplication = new Map<string, Set<string>>();
  for (const data of lineages) {
    const key = applicationNodeId(data.application.id);
    const ids = byApplication.get(key) ?? new Set<string>();
    for (const id of lineageRecordIds(data)) ids.add(id);
    byApplication.set(key, ids);
  }
  return byApplication;
}
