import type { LineSources } from "./line-sources";
import templateFixture from "../../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import type { IsometricComponentBlueprint } from "../projects";
import type { GhgEntryTemplate, TemplateEnrichment } from "./types";

export function timeBasedEmissionsFixture() {
  const template = structuredClone(templateFixture) as GhgEntryTemplate;
  const group = template.groups.find((candidate) => candidate.key === "pyrolysis")!;
  group.key = "direct-emissions";
  const component = group.components[0];
  component.id = "time-line";
  component.blueprint_key = "time_based_emissions";
  component.inputs = [
    { input_key: "emissions_per_unit_time", display_name: "Emission rate", type: "fixed", quantity_kind: "time_emission_factor", datapoint_id: "fixed-rate" },
    { input_key: "time", display_name: "Operating time", type: "monitored", quantity_kind: "time", datapoint_id: null },
  ];
  group.components = [component];
  template.groups = [group];
  const blueprint: IsometricComponentBlueprint = {
    key: component.blueprint_key, display_name: "Time-based emissions", description: "", type: "ACTIVITY", expressions: [],
    inputs: [
      { input_key: "emissions_per_unit_time", quantity_kind: "time_emission_factor", compatible_unit: "kgCO2e / day", data_shape: "SCALAR", description: "" },
      { input_key: "time", quantity_kind: "time", compatible_unit: "second", data_shape: "SCALAR", description: "" },
    ],
  };
  const enrichment: TemplateEnrichment = {
    [component.id]: {
      emissions_per_unit_time: { unit: "kgCO2e / hour", fixedValue: "2", deprecated: null },
      time: { unit: "hour", deprecated: null },
    },
  };
  return { template, blueprint, enrichment };
}

/** Tests only. Real acceptance requires the Admin change-review action. */
export function acceptAllProposals(lineSources: LineSources): LineSources {
  return Object.fromEntries(Object.entries(lineSources).map(([id, contract]) => [
    id, { ...contract, origin: contract.origin === "proposed" ? "reviewed" : contract.origin },
  ]));
}
