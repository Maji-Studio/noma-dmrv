import { and, eq, inArray } from "drizzle-orm";
import { deliveries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { CreditBatchLineageFacts } from "./credit-batch-lineage-types";
import type { AllocationDeliveryFact, AllocationManualFact } from "@/lib/certification/emission-allocation-facts";
import { emissionDeliveryShares } from "@/lib/certification/emission-delivery-shares";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import { formatUtcDate } from "@/lib/date-utils";
import type { Quantity } from "@/types/emission-allocation";
import { loadBiocharDeliveryTransportLegs } from "./biochar-delivery-transport";
import { listEmissionEntriesForBatches } from "./emission-entries";
import { requireOrgScope, type Executor } from "./utils";

const VOLUME_SCALES: Record<string, number> = { L: 1, mL: 0.001, "m^3": 1000 };
const ENERGY_SCALES: Record<string, number> = { kWh: 1, Wh: 0.001, MWh: 1000, MJ: 1 / 3.6, J: 1 / 3_600_000 };

export async function loadAllocationDeliveries(ctx: OrgContext,
  batches: { id: string; code: string; lineageFacts: CreditBatchLineageFacts }[], reader: Executor,
): Promise<AllocationDeliveryFact[]> {
  requireOrgScope(ctx);
  const loads = new Map<string, AllocationDeliveryFact["loads"]>();
  for (const batch of batches) {
    for (const share of emissionDeliveryShares(batch.lineageFacts.runForwards)) {
      const group = loads.get(share.id) ?? [];
      group.push({ creditBatchId: batch.id, code: batch.code, kg: share.exactWetMassKg === null ? null : Number(share.exactWetMassKg) });
      loads.set(share.id, group);
    }
  }
  const ids = [...loads.keys()];
  if (!ids.length) return [];
  const rows = await reader.select().from(deliveries)
    .where(and(eq(deliveries.organizationId, ctx.organizationId), inArray(deliveries.id, ids)));
  const legs = await loadBiocharDeliveryTransportLegs(ctx, rows.map(row => ({ deliveryId: row.id, loadMassKg: Number(row.deliveredWetMassKg ?? 0) })), reader);
  const byId = new Map(legs.map(leg => [leg.id, leg]));
  return rows.map(row => ({ id: row.id, code: row.code, date: formatUtcDate(row.deliveryDate),
    wetKg: row.deliveredWetMassKg, oneWayKm: (byId.get(row.id)?.distanceKm ?? 0) > 0 ? byId.get(row.id)!.distanceKm : null,
    loads: loads.get(row.id)! }));
}

function activityQuantity(value: { magnitude: string; unit: string; inputKey: string }): Quantity | null {
  const volume = canonicalUnit("volume", value.unit);
  if (volume && Object.hasOwn(VOLUME_SCALES, volume)) return { value: Number(value.magnitude) * VOLUME_SCALES[volume], unit: "L", label: value.inputKey };
  const energy = canonicalUnit("energy", value.unit);
  if (energy && Object.hasOwn(ENERGY_SCALES, energy)) return { value: Number(value.magnitude) * ENERGY_SCALES[energy], unit: "kWh", label: value.inputKey };
  if (canonicalUnit("mass_distance", value.unit) === canonicalUnit("mass_distance", "tonne * km"))
    return { value: Number(value.magnitude), unit: "t·km", label: value.inputKey };
  return null;
}

/** Entries retain their recorded batch even while their template needs reconfirmation. */
export async function loadAllocationManualEntries(ctx: OrgContext, batchIds: string[], reader: Executor): Promise<AllocationManualFact[]> {
  requireOrgScope(ctx);
  const entries = await listEmissionEntriesForBatches(ctx, batchIds, reader);
  return entries.map(entry => {
    const quantities: Quantity[] = [];
    const omittedInputKeys: string[] = [];
    for (const value of entry.values) {
      const quantity = activityQuantity(value);
      if (quantity) quantities.push(quantity);
      else omittedInputKeys.push(value.inputKey);
    }
    return { id: entry.id, componentId: entry.componentId, date: entry.occurredOn, creditBatchId: entry.creditBatchId,
      kind: entry.kind, quantities, omittedInputKeys };
  });
}
