import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import type { TemplateDefinition } from "@/lib/isometric/template-observations/types";
import type { Quantity } from "@/types/emission-allocation";
import type { AllocationManualFact } from "./emission-allocation-facts";
import { withRemovedEntryComponents } from "./emission-line-definition";

const VOLUME_SCALES: Record<string, number> = { L: 1, mL: 0.001, "m^3": 1000 };
const ENERGY_SCALES: Record<string, number> = { kWh: 1, Wh: 0.001, MWh: 1000, MJ: 1 / 3.6, J: 1 / 3_600_000 };
/** Same quantity labels as runs and transport legs; templates carry no input names. */
const UNIT_LABELS: Record<Quantity["unit"], string> = { L: "Diesel", kWh: "Electricity", "t·km": "Transport" };

interface ManualEntry {
  id: string;
  componentId: string;
  creditBatchId: string;
  removalTemplateId: string;
  observationId: string;
  occurredOn: string;
  kind: "value" | "zero";
  values: { inputKey: string; magnitude: string; unit: string }[];
}

interface Observation {
  id: string;
  externalTemplateId: string;
  definition: TemplateDefinition;
}

function activityQuantity(value: ManualEntry["values"][number]): Quantity | null {
  const volume = canonicalUnit("volume", value.unit);
  if (volume && Object.hasOwn(VOLUME_SCALES, volume)) return { value: Number(value.magnitude) * VOLUME_SCALES[volume], unit: "L", label: UNIT_LABELS.L };
  const energy = canonicalUnit("energy", value.unit);
  if (energy && Object.hasOwn(ENERGY_SCALES, energy)) return { value: Number(value.magnitude) * ENERGY_SCALES[energy], unit: "kWh", label: UNIT_LABELS.kWh };
  if (canonicalUnit("mass_distance", value.unit) === canonicalUnit("mass_distance", "tonne * km"))
    return { value: Number(value.magnitude), unit: "t·km", label: UNIT_LABELS["t·km"] };
  return null;
}

/** Reuse the Emissions tab's definition, including its retained removed components. */
export function buildAllocationManualFacts(
  entries: readonly ManualEntry[], current: readonly Observation[], previous: readonly Observation[],
): AllocationManualFact[] {
  const byId = new Map([...previous, ...current].map(observation => [observation.id, observation]));
  const definitions = new Map(current.map(observation => [observation.externalTemplateId,
    withRemovedEntryComponents(observation.definition,
      entries.filter(entry => entry.removalTemplateId === observation.externalTemplateId), byId)]));
  return entries.map(entry => {
    const definition = definitions.get(entry.removalTemplateId) ?? byId.get(entry.observationId)?.definition;
    const component = definition?.groups.flatMap(group => group.components).find(component => component.id === entry.componentId);
    const quantities: Quantity[] = [];
    const omittedInputKeys: string[] = [];
    for (const value of entry.values) {
      const quantity = activityQuantity(value);
      if (quantity) quantities.push(quantity);
      else omittedInputKeys.push(value.inputKey);
    }
    return { id: entry.id, componentId: entry.componentId, componentName: component?.displayName ?? entry.componentId,
      date: entry.occurredOn, creditBatchId: entry.creditBatchId, kind: entry.kind, quantities, omittedInputKeys };
  });
}
