import { SEMANTIC_BINDING_CATALOG } from "../semantic-binding-catalog";
import type { EntryPolicy, QuantityKind, TemplateComponent } from "./types";

const ADDITIVE_QUANTITY_KINDS = new Set(["volume", "energy", "mass", "distance", "mass_distance"]);
const GAS_CONCENTRATION_KINDS = new Set(["mass_fraction", "mass_concentration"]);
const GAS_MASS_KINDS = new Set(["mass", "mass_flow_rate"]);
const ENERGY_KINDS = new Set(["energy"]);
const MASS_KINDS = new Set(["mass"]);
const DISTANCE_KINDS = new Set(["distance"]);

// Shape support is deliberately limited to known input keys. A lone meter
// readout or gas-mass input is not an additive energy or mass entry.
const ADDITIVE_INPUTS = new Map<string, Set<QuantityKind>>();
for (const inputs of Object.values(SEMANTIC_BINDING_CATALOG)) {
  for (const [key, binding] of Object.entries(inputs)) {
    const kind = binding.datapoint?.expectedQuantityKind;
    if (!kind || !ADDITIVE_QUANTITY_KINDS.has(kind)) continue;
    const kinds = ADDITIVE_INPUTS.get(key) ?? new Set<QuantityKind>();
    kinds.add(kind);
    ADDITIVE_INPUTS.set(key, kinds);
  }
}
// Staff distance is cataloged as project-scope today, without a datapoint
// contract. Entries add support without changing the existing submit path.
ADDITIVE_INPUTS.set("distance", new Set(["distance"]));

/** `none` is always available, including storage and unsupported shapes. */
export function allowedEntryPolicies(component: TemplateComponent): EntryPolicy[] {
  const inputs = component.inputs.filter((input) => input.type === "monitored");
  if (inputs.length === 1 && ADDITIVE_INPUTS.get(inputs[0].key)?.has(inputs[0].quantityKind)) {
    return ["none", "additive"];
  }
  if (inputs.length !== 2) return ["none"];
  const has = (key: string, kinds: ReadonlySet<string>) =>
    inputs.some((input) => input.key === key && kinds.has(input.quantityKind));
  if (has("initial_readout", ENERGY_KINDS) && has("final_readout", ENERGY_KINDS)) return ["none", "single"];
  if (has("concentration", GAS_CONCENTRATION_KINDS) && has("mass_flow", GAS_MASS_KINDS)) return ["none", "single"];
  if (has("mass", MASS_KINDS) && has("distance", DISTANCE_KINDS)) return ["none", "additive"];
  return ["none"];
}
