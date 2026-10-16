import type { BatchRunForwardDeliveryFact, CreditBatchLineageFacts } from "@/data-access/credit-batch-lineage-types";
import { sumFigures } from "./emission-lines";

/** Each run/product row is a distinct share, not a duplicate load. Combine shares
 * before producing one delivery leg, retaining exact text for subsequent math.
 */
export function emissionDeliveryShares(forwards: CreditBatchLineageFacts["runForwards"]) {
  const byDelivery = new Map<string, { delivery: BatchRunForwardDeliveryFact; masses: string[]; missing: boolean }>();
  const seen = new Set<string>();
  for (const [runId, products] of Object.entries(forwards ?? {})) {
    for (const product of products) for (const delivery of product.deliveries) {
      const key = JSON.stringify([runId, product.id, delivery.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      const group = byDelivery.get(delivery.id) ?? { delivery, masses: [], missing: false };
      if (delivery.wetMassKg === null) group.missing = true;
      else group.masses.push(String(delivery.wetMassKg));
      byDelivery.set(delivery.id, group);
    }
  }
  return [...byDelivery.values()].map(({ delivery, masses, missing }) => ({
    ...delivery, exactWetMassKg: missing ? null : sumFigures(masses.map(magnitude => ({ magnitude, unit: "kg" })))?.magnitude ?? null,
  }));
}
