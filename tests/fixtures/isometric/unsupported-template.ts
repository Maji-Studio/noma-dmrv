import sandbox from "./sandbox-template.json";
import type { components } from "@/lib/isometric/generated/certify";
type Template = components["schemas"]["GhgEntryTemplate"];
const template = sandbox as Template;
// Synthetic guard regression, not a snapshot of the unavailable production template.
export function unsupportedTemplate(): Template {
  const copy = structuredClone(template);
  for (const group of copy.groups) {
    if (!["biomass-feedstock-transport", "biochar-transport"].includes(group.key)) continue;
    const component = group.components.find((component) => component.blueprint_key === "mass_distance_based_ci_emissions")!;
    component.blueprint_key = "transport";
    component.inputs = ["mass", "distance"].map((input_key) => ({
      input_key, type: "monitored", datapoint_id: null,
      display_name: input_key, quantity_kind: input_key,
    })) as typeof component.inputs;
  }
  const samples = copy.groups.find((group) => group.key === "sampling-required-for-mrv")!;
  const feedstock = template.groups.find((group) => group.key === "biomass-feedstock-transport")!.components[0];
  samples.components.push({ ...structuredClone(feedstock), id: "sample-shipment", display_name: "Samples to EU lab" });
  return copy;
}

