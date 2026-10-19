import type { EmissionLineEntryFact } from "@/lib/certification/emission-lines";
import { effectiveContract, type LineSources } from "@/lib/isometric/template-observations/line-sources";
import { ownValue } from "@/lib/isometric/semantic-binding-catalog";
import type { EnergyFlow } from "./types";

const FACILITY_ENERGY_SOURCES = {
  "run-startup-diesel": { source: "startup", units: { L: 1, mL: 0.001, "m^3": 1000 } },
  // This catalog source combines genset and preprocessing litres. Additional
  // entries belong to its generator line, without inventing a preprocessing split.
  "run-genset-diesel": { source: "genset", units: { L: 1, mL: 0.001, "m^3": 1000 } },
  "run-electricity": { source: "grid", units: { kWh: 1, Wh: 0.001, MWh: 1000, MJ: 1 / 3.6, J: 1 / 3600000 } },
} as const;

type EnergyEntryFact = EmissionLineEntryFact & {
  creditBatchId: string; occurredOn: string; deletedAt: Date | null;
};

/** Contracts, not line names or units alone, decide whether an entry is site energy. */
export function emissionEntryFlows(entries: readonly EnergyEntryFact[], lineSources: LineSources): EnergyFlow[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "value" || entry.deletedAt || !entry.counts || entry.unitMismatch || !entry.total) return [];
    const stored = ownValue(lineSources, entry.componentId);
    const contract = stored && effectiveContract(stored);
    if (contract?.scope !== "operating" || contract.entryPolicy === "none" || !contract.automaticSource) return [];
    const activity = ownValue(FACILITY_ENERGY_SOURCES, contract.automaticSource);
    if (!activity) return [];
    const scale = ownValue<number>(activity.units, entry.total.unit);
    if (scale === undefined) return [];
    return [{ source: activity.source, creditBatchId: entry.creditBatchId, day: entry.occurredOn,
      activity: Number(entry.total.magnitude) * scale }];
  });
}
