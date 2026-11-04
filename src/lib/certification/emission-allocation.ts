import { countedRoundTripKm } from "@/lib/calculations/round-trip";
import { massGrams } from "@/lib/calculations/gram-allocation";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { NOT_YET, type AllocationRecord, type EmissionAllocation, type Part, type PartBasis } from "@/types/emission-allocation";
import type { AllocationDeliveryFact, AllocationFeedstockFact, EmissionAllocationFacts } from "./emission-allocation-facts";

function wholePart(creditBatchId: string | null, basis: PartBasis): Part[] {
  return [{ key: creditBatchId ?? NOT_YET, fraction: 1, basis: [basis] }];
}

function claimedPart(removalId: string | null | undefined, label: string): Part[] {
  return wholePart(removalId ?? null, { kind: removalId ? "claim" : "notYet", label, kg: null });
}

/** Loads already come from the submission's frozen application lineage. */
function deliveryRemovalParts(fact: AllocationDeliveryFact): Part[] {
  const total = fact.wetKg ?? 0;
  const parts: Part[] = [];
  let assigned = 0;
  for (const load of fact.removalLoads ?? []) {
    if (load.kg < 0 || total > 0 && massGrams(assigned + load.kg) > massGrams(total)) {
      throw new Error("Removal application slices exceed the whole delivery load");
    }
    assigned += load.kg;
    parts.push({ key: load.removalId, fraction: total > 0 ? load.kg / total : 0,
      basis: [{ kind: "slice", label: load.code, kg: load.kg, recordId: fact.id }] });
  }
  if (massGrams(assigned) < massGrams(total) || total <= 0 || !parts.length) {
    parts.push({ key: NOT_YET, fraction: total > 0 ? (total - assigned) / total : 1,
      basis: [{ kind: "notYet", label: fact.code, kg: total > 0 ? total - assigned : null }] });
  }
  const last = parts.findLastIndex(part => part.fraction > 0);
  if (last >= 0) parts[last].fraction = 1 - parts.slice(0, last).reduce((sum, part) => sum + part.fraction, 0);
  return parts;
}

function feedstockRecord(fact: AllocationFeedstockFact, claims: EmissionAllocationFacts["productionClaims"]): AllocationRecord {
  const { usage } = fact;
  const owner = usage.owningBatch?.creditBatchId ?? null;
  const tonneKm = !fact.legs.length || fact.legs.some(leg => leg.loadKg === null || leg.loadKg <= 0 || leg.oneWayKm <= 0)
    ? null : fact.legs.reduce((sum, leg) => sum + kgToTonnes(leg.loadKg!) * countedRoundTripKm(leg.oneWayKm), 0);
  const parts = wholePart(owner, owner && fact.firstRun
    ? { kind: "firstRun", label: fact.firstRun.code, recordId: fact.firstRun.id, kg: null }
    : { kind: "notYet", label: fact.binName, kg: usage.intakeWetKg });
  // A later touching batch carries zero transport, but keeps its hint-A usage.
  for (const batch of usage.creditBatches) {
    if (batch.creditBatchId !== owner) parts.push({ key: batch.creditBatchId, fraction: 0,
      basis: [{ kind: "run", label: batch.code, kg: batch.wetKg }] });
  }
  return {
    id: fact.id, code: fact.code, group: "feedstockTransport", date: fact.date,
    detail: { kind: "feedstockTransport", binId: fact.binId, binName: fact.binName, wetKg: usage.intakeWetKg, legs: fact.legs },
    quantities: [{ value: tonneKm, unit: "t·km", label: "Transport" }], parts,
    removalParts: claimedPart(owner ? claims?.[owner] : null, fact.code),
    basisWord: "the first run that drew from it",
    feedstock: {
      bin: fact.binName, binId: fact.binId, wetKg: usage.intakeWetKg, tonneKm,
      used: usage.creditBatches.map(batch => ({ creditBatchId: batch.creditBatchId, code: batch.code,
        kg: batch.wetKg, runs: fact.runsByBatch[batch.creditBatchId] ?? [] })),
      lostKg: usage.lostWetKg, out: usage.lostWetKg > 0 ? [{ kind: "lost", date: null, kg: usage.lostWetKg }] : [],
      stillKg: usage.stillInBinWetKg, ingredientKg: usage.ingredientWetKg,
      countKg: usage.countWetKg, unbatchedRunKg: usage.unbatchedRunWetKg,
      firstRun: fact.firstRun, owner, reason: owner ? "firstRun" : "notYet",
    },
  };
}

function deliveryRecord(fact: AllocationDeliveryFact): AllocationRecord {
  const totalGrams = fact.wetKg === null ? 0 : massGrams(fact.wetKg);
  const knownMass = totalGrams > 0;
  const parts: Part[] = [];
  let assignedGrams = 0;
  for (const load of fact.loads) {
    const grams = knownMass && load.kg !== null ? massGrams(load.kg) : 0;
    if (grams < 0 || assignedGrams + grams > totalGrams) throw new Error("Delivery batch shares exceed the whole load");
    parts.push({ key: load.creditBatchId, fraction: knownMass ? grams / totalGrams : 0,
      basis: [{ kind: "load", label: load.code, kg: load.kg }] });
    assignedGrams += grams;
  }
  if (assignedGrams < totalGrams || !knownMass || !parts.length) parts.push({ key: NOT_YET,
    fraction: knownMass ? (totalGrams - assignedGrams) / totalGrams : 1,
    basis: [{ kind: "notYet", label: fact.code, kg: knownMass ? fact.wetKg! * (totalGrams - assignedGrams) / totalGrams : null }] });
  // Assign the floating point remainder to the last positive part. Ordered sums
  // are exactly 1 while the physical load shares retain their precision.
  const last = parts.findLastIndex(part => part.fraction > 0);
  if (last >= 0) parts[last].fraction = 1 - parts.slice(0, last).reduce((sum, part) => sum + part.fraction, 0);
  return {
    id: fact.id, code: fact.code, group: "deliveryTransport", date: fact.date,
    detail: { kind: "deliveryTransport", wetKg: fact.wetKg, oneWayKm: fact.oneWayKm },
    quantities: [{ value: fact.wetKg === null || fact.oneWayKm === null ? null
      : kgToTonnes(fact.wetKg) * countedRoundTripKm(fact.oneWayKm), unit: "t·km", label: "Transport" }],
    parts, removalParts: deliveryRemovalParts(fact), basisWord: "biochar on the load",
  };
}

/** Pure projection of saved facts. Ownership and physical stock replay stay in their existing seams. */
export function buildEmissionAllocation(facts: EmissionAllocationFacts): EmissionAllocation {
  const records: AllocationRecord[] = [
    ...facts.feedstocks.map(fact => feedstockRecord(fact, facts.productionClaims)),
    ...facts.runs.map((run): AllocationRecord => ({
      id: run.id, code: run.code, group: "production", date: run.date,
      detail: { kind: "production", reactorId: run.reactorId, reactorCode: run.reactorCode },
      quantities: [
        { value: run.dieselOperationLiters, unit: "L", label: "Startup diesel" },
        { value: run.dieselGensetLiters, unit: "L", label: "Generator diesel" },
        { value: run.preprocessingFuelLiters, unit: "L", label: "Preprocessing diesel" },
        { value: run.electricityKwh, unit: "kWh", label: "Electricity" },
      ],
      parts: wholePart(run.creditBatchId, { kind: run.creditBatchId ? "run" : "notYet", label: run.code, recordId: run.id, kg: null }),
      removalParts: claimedPart(run.creditBatchId ? facts.productionClaims?.[run.creditBatchId] : null, run.code),
      basisWord: "the run",
    })),
    ...facts.deliveries.map(deliveryRecord),
    ...facts.manual.map((entry): AllocationRecord => ({
      id: entry.id, code: entry.componentId, group: "manual", date: entry.date,
      detail: { kind: "manual", creditBatchId: entry.creditBatchId, componentId: entry.componentId,
        componentName: entry.componentName, kindOfEntry: entry.kind, omittedInputKeys: entry.omittedInputKeys },
      quantities: entry.quantities,
      parts: wholePart(entry.creditBatchId, { kind: "recordedOnBatch", label: entry.componentId, recordId: entry.id, kg: null }),
      removalParts: claimedPart(entry.removalId, entry.componentId),
      basisWord: "the batch it was recorded on",
    })),
  ];
  return { facilityId: facts.facilityId, batches: facts.batches, removals: facts.removals,
    records: records.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code) || a.id.localeCompare(b.id)) };
}
