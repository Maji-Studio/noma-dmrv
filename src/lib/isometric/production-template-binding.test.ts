import { describe, expect, it } from "vitest";
import production from "../../../tests/fixtures/isometric/production-template-2026-07-03.json";
import type { components } from "./generated/certify";
import { findUnbindableTemplateInputs, formatUnbindableTemplateInputs } from "./template-binding-coverage";
import { buildCreateDatapointRequest } from "./transformers/datapoint";
import { assertSequestrationTemplateBindings } from "./transformers/sequestration-binding";
import type { AggregatedProductionData } from "./utils/aggregation";

const template = production as components["schemas"]["GhgEntryTemplate"];
const expectedFindings = [
  ["rtc_1KWKNGJZY1S0D548", "distance", "unmapped"],
  ["rtc_1KWKNGJZY1S0MEVJ", "final_readout", "unmapped"],
  ["rtc_1KWKNGJZY1S0MEVJ", "initial_readout", "unmapped"],
  ["rtc_1KWKNGJZY1S0VRJW", "concentration", "project-scope"],
  ["rtc_1KWKNGJZY1S0VRJW", "mass_flow", "project-scope"],
  ["rtc_1KWKNGJZY1S0FDEH", "concentration", "project-scope"],
  ["rtc_1KWKNGJZY1S0FDEH", "mass_flow", "project-scope"],
  ["rtc_1KWKNGJZY1S032A6", "distance", "unmapped"],
  ["rtc_1KWKNGJZY1S0AC1G", "electricity_use", "project-scope"],
  ["rtc_1KWKNGJZY1S0Y0X5", "mass", "project-scope"],
  ["rtc_1KWKNGJZY1S05AMF", "distance", "project-scope"],
  ["rtc_1KWKNGJZY1S0RZG4", "distance", "project-scope"],
  ["rtc_1KWKNGJZY1S0CMBS", "mass", "project-scope"],
];
const acceptedInputs: Record<string, { unit: string; magnitude: number }> = {
  "rtc_1KWKNGJZY1S00SZX/volume_of_fuel": { unit: "l", magnitude: 20 },
  "rtc_1KWKNGJZY1S083Q7/volume_of_fuel": { unit: "l", magnitude: 50 },
  "rtc_1KWKNGJZY1S0PQ5V/carbon_content": { unit: "dimensionless", magnitude: 0.8 },
  "rtc_1KWKNGJZY1S0PQ5V/product_mass": { unit: "kg", magnitude: 1000 },
  "rtc_1KWKNGJZY1S0HNRT/mass_distance": { unit: "tonne * km", magnitude: 12 },
};
const agg: AggregatedProductionData = {
  weightedOrganicCarbonPercent: 80,
  weightedHToCorgRatio: 0.4,
  weightedOToCorgRatio: 0.2,
  weightedAshPercent: 5,
  weightedMoisturePercent: 10,
  totalBiocharDryMassKg: 1000,
  totalFeedstockDryMassKg: 4000,
  totalStartupDieselLitres: 50,
  totalGensetDieselLitres: 20,
  // Combined diesel litres = 50 startup + 20 genset (issue #319 — submitted
  // by volume through pyrolysis/fuel_usage_by_volume).
  totalDieselLitres: 70,
  totalElectricityKwh: 200,
  feedstockTransportMassDistanceTonneKm: 50,
  biocharTransportMassDistanceTonneKm: 100,
  sampleTransportMassDistanceTonneKm: 12,
  earliestStartTime: new Date("2026-01-01T00:00:00Z"),
  latestEndTime: new Date("2026-01-31T23:59:59Z"),
  sourceProductionRunIds: ["pr_1", "pr_2"],
  warnings: [],
};

describe("production template binding coverage", () => {
  it("preserves the production inventory and reports every refused input, once per truck", () => {
    expect(template.id).toBe("rvt_1KWKNGJZY1S0T112");
    expect(template.groups).toHaveLength(13);
    expect(template.groups.flatMap((group) => group.components)).toHaveLength(14);
    const findings = findUnbindableTemplateInputs(template);
    expect(findings.map((input) => [input.componentId, input.inputKey, input.reason])).toEqual(expectedFindings);
    for (const finding of findings.filter((input) => input.blueprintKey === "transport")) {
      expect(formatUnbindableTemplateInputs([finding])).toBe(`The Removal template has 1 component noma cannot submit.\n${finding.componentDisplayName}: Replace it with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.`);
    }
    expect(findings.some((input) => input.componentId === "rtc_1KWKNGJZY1S0HNRT")).toBe(false);
    expect(() => assertSequestrationTemplateBindings(template)).not.toThrow();
  });

  it("groups production copy without keys or repeated components and preserves Safety margin", () => {
    const copy = formatUnbindableTemplateInputs(findUnbindableTemplateInputs(template));
    expect(copy.split("\n")).toEqual([
      "The Removal template has 10 components noma cannot submit.",
      "Biomass transportation to processing site via truck and Biochar transportation to storage site via truck: Replace each one with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.",
      "Metered electricity use emissions: Pick another Removal template or ask support to add the mapping.",
      "Pyrolyzer CO emissions, Pyrolyzer CH4 emissions, Laboratory analysis electricity use, Sampling consumables, Staff travel flights and Staff travel local: Add each one as a project component in Isometric, then remove them from the Removal template.",
      'Mass-based CI emissions: This component can stay on the Removal only under its expected name. Rename it in Isometric to "Safety margin".',
    ]);
    expect(copy.match(/Metered electricity use emissions/g)).toHaveLength(1);
    expect(copy).not.toContain("ghg_direct_emissions");
    const renamed = structuredClone(template);
    renamed.groups.find((group) => group.key === "miscellaneous")!.components[0].display_name = "Safety margin";
    expect(findUnbindableTemplateInputs(renamed).some((input) => input.componentId === "rtc_1KWKNGJZY1S0CMBS")).toBe(false);
  });

  it.each([false, true])("agrees with actual datapoint builds (sandbox stubs: %s)", (allowPeriodInputStub) => {
    const findings = findUnbindableTemplateInputs(template, { allowPeriodInputStub });
    for (const group of template.groups) for (const component of group.components) {
      for (const input of component.inputs) {
        if (input.type === "fixed") {
          expect(input.datapoint_id).toMatch(/^dtp_/);
          continue;
        }
        const accepted = acceptedInputs[`${component.id}/${input.input_key}`];
        const expected = expectedFindings.find(([id, key]) => id === component.id && (key === input.input_key || component.blueprint_key === "transport"));
        const shouldReject = !!expected && !(allowPeriodInputStub && expected[2] === "project-scope");
        const build = () => buildCreateDatapointRequest({
          groupKey: group.key,
          componentBlueprintKey: component.blueprint_key,
          componentDisplayName: component.display_name,
          rtcInput: input,
          // Snapshot has no complete REST blueprint metadata. Use explicit test
          // units for supported mappings; rejected tuples fail before unit checks.
          blueprintInput: { input_key: input.input_key, compatible_unit: accepted?.unit ?? "dimensionless", quantity_kind: input.quantity_kind, data_shape: "SCALAR", description: "" },
          agg, projectId: template.project_id, supplierRefId: "test-production-coverage", allowPeriodInputStub,
        });
        expect(findings.some((finding) => finding.componentId === component.id && (finding.inputKey === input.input_key || component.blueprint_key === "transport"))).toBe(shouldReject);
        if (shouldReject) {
          expect(build).toThrow(expected?.[2] === "project-scope" ? /belongs at the project level/ : /not supported/);
        } else {
          expect(build().quantity.magnitude).toBe(accepted?.magnitude ?? 0);
        }
      }
    }
  });
});
