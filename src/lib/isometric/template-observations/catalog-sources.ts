import {
  ownValue, SAFETY_MARGIN_CARVE_OUT, SEMANTIC_BINDING_CATALOG,
  type BindingRole, type SourceFactKey,
} from "../semantic-binding-catalog";
import { compareIds } from "./normalize";
import type { TemplateComponent, TemplateInput } from "./types";

/** Stable persisted IDs. Tuples and group permissions stay in the catalog. */
const SOURCE_IDS = {
  totalGensetDieselLitres: "run-genset-diesel",
  totalStartupDieselLitres: "run-startup-diesel",
  totalElectricityKwh: "run-electricity",
  feedstockTransportMassDistanceTonneKm: "feedstock-transport",
  biocharTransportMassDistanceTonneKm: "delivery-transport",
  sampleTransportMassDistanceTonneKm: "sample-transport",
  totalFeedstockDryMassKg: "feedstock-dry-mass",
  totalBiocharDryMassKg: "biochar-dry-mass",
  weightedOrganicCarbonPercent: "sequestration",
} as const satisfies Partial<Record<SourceFactKey, string>>;

export type AutomaticSourceId = typeof SOURCE_IDS[keyof typeof SOURCE_IDS] | "safety-margin";

function roleSources(role: BindingRole, groupKey: string): AutomaticSourceId[] {
  if (role.strategy === "project-scope-forbidden") return [];
  if (role.strategy === "measurement-sample" || groupKey === "co2-stored") return ["sequestration"];
  if (role.disambiguation?.name === SAFETY_MARGIN_CARVE_OUT.name) return ["safety-margin"];
  const facts = role.disambiguation ? Object.values(role.disambiguation.sources) : [role.source];
  return facts.flatMap((fact) => {
    const id = ownValue<AutomaticSourceId>(SOURCE_IDS, fact);
    return id ? [id] : [];
  });
}

/** Only IDs with an operative catalog role are offered. */
export const AUTOMATIC_SOURCE_IDS: readonly AutomaticSourceId[] = [...new Set(
  Object.values(SEMANTIC_BINDING_CATALOG).flatMap((inputs) => Object.values(inputs).flatMap((binding) =>
    Object.entries(binding.roles).flatMap(([groupKey, role]) => roleSources(role, groupKey)),
  )),
)].sort(compareIds);

function inputCandidates(blueprintKey: string, input: TemplateInput, groupKey: string): AutomaticSourceId[] {
  const binding = ownValue(SEMANTIC_BINDING_CATALOG, blueprintKey);
  const inputBinding = binding && ownValue(binding, input.key);
  const role = inputBinding && ownValue(inputBinding.roles, groupKey);
  if (!role || (inputBinding?.datapoint && inputBinding.datapoint.expectedQuantityKind !== input.quantityKind)) return [];
  if (role.strategy === "measurement-sample" && role.source === "direct-datapoint" && role.quantityKind !== input.quantityKind) return [];
  return roleSources(role, groupKey);
}

/** No display-name resolution: disambiguated roles expose all review choices. */
export function catalogCandidates(component: TemplateComponent, groupKey: string): AutomaticSourceId[] {
  const monitored = component.inputs.filter((input) => input.type === "monitored");
  if (monitored.length === 0) return [];
  // Legacy trucks use paired mass/distance. Their source choices are the same
  // catalog transport roles as the replacement mass-distance blueprint (#1020).
  if (component.blueprintKey === "transport" && monitored.length === 2 &&
      monitored.some((input) => input.key === "mass" && input.quantityKind === "mass") &&
      monitored.some((input) => input.key === "distance" && input.quantityKind === "distance")) {
    return [...new Set(Object.values(SEMANTIC_BINDING_CATALOG).flatMap((inputs) =>
      Object.values(inputs).flatMap((binding) => {
        const role = ownValue(binding.roles, groupKey);
        return binding.datapoint?.expectedQuantityKind === "mass_distance" && role ? roleSources(role, groupKey) : [];
      }),
    ))].sort(compareIds);
  }
  const candidates = monitored.map((input) => inputCandidates(component.blueprintKey, input, groupKey));
  return [...new Set(candidates[0].filter((id) => candidates.every((options) => options.includes(id))))].sort(compareIds);
}

export function hasCatalogDisambiguation(blueprintKey: string): boolean {
  const bindings = ownValue(SEMANTIC_BINDING_CATALOG, blueprintKey);
  return Object.values(bindings ?? {}).some((binding) => Object.values(binding.roles).some((role) =>
    role.strategy === "aggregated-datapoint" && role.disambiguation !== undefined,
  ));
}
