import { expect, it } from "vitest";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import { storedRemovalTemplateFacts } from "./stored-removal-template";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations";

it("restores the observed input identities, fixed datapoints and compatible units without a registry client", () => {
  const observation = {
    externalTemplateId: "template", externalProjectId: "project", lineSources: {},
    definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Production", description: "",
      components: [{ id: "energy", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
        inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" },
          { key: "grid_ci", type: "fixed", quantityKind: "energy_carbon_emission_factor", fixedDatapointId: "fixed" }] }] }] },
    enrichment: { energy: { electricity_use: { unit: "kWh" }, grid_ci: { unit: "kgCO2e/kWh", fixedValue: "0.2" } } },
  } as unknown as RemovalTemplateObservation;
  const facts = storedRemovalTemplateFacts(observation);
  expect(normalizeTemplateDefinition(facts.template)).toEqual(observation.definition);
  expect(facts.blueprintsForTemplate[0].inputs[0]).toMatchObject({ input_key: "electricity_use", compatible_unit: "kWh", quantity_kind: "energy" });
  expect(facts.template.groups[0].components[0].inputs[1].datapoint_id).toBe("fixed");
});
