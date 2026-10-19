import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import { describe, expect, it } from "vitest";
import production from "../../../tests/fixtures/isometric/production-template-2026-07-03.json";
import type { components } from "./generated/certify";
import { findUnbindableTemplateInputs as findCoverage, formatUnbindableTemplateInputsText } from "./template-binding-coverage";
import { buildCreateDatapointRequest } from "./transformers/datapoint";
import { assertSequestrationTemplateBindings } from "./transformers/sequestration-binding";
import type { AggregatedProductionData } from "./utils/aggregation";

const template = production as components["schemas"]["GhgEntryTemplate"];
const expectedFindings = [
  ["rtc_1KWKNGJZY1S0D548", "distance", "unmapped"],
  ["rtc_1KWKNGJZY1S0MEVJ", "final_readout", "unmapped"],
  ["rtc_1KWKNGJZY1S0MEVJ", "initial_readout", "unmapped"],
  ["rtc_1KWKNGJZY1S0VRJW", "concentration", "unmapped"],
  ["rtc_1KWKNGJZY1S0VRJW", "mass_flow", "unmapped"],
  ["rtc_1KWKNGJZY1S0FDEH", "concentration", "unmapped"],
  ["rtc_1KWKNGJZY1S0FDEH", "mass_flow", "unmapped"],
  ["rtc_1KWKNGJZY1S032A6", "distance", "unmapped"],
  ["rtc_1KWKNGJZY1S0AC1G", "electricity_use", "unmapped"],
  ["rtc_1KWKNGJZY1S0Y0X5", "mass", "unmapped"],
  ["rtc_1KWKNGJZY1S05AMF", "distance", "unmapped"],
  ["rtc_1KWKNGJZY1S0RZG4", "distance", "unmapped"],
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
      expect(formatUnbindableTemplateInputsText([finding])).toBe(`The Removal template has 1 component noma cannot submit.\n${finding.componentDisplayName} (${finding.componentId}; blueprint ${finding.blueprintKey}; input ${finding.inputKey}): Replace it with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.`);
    }
    expect(findings.some((input) => input.componentId === "rtc_1KWKNGJZY1S0HNRT")).toBe(false);
    expect(() => assertSequestrationTemplateBindings(template)).not.toThrow();
  });

  it("groups production copy and keeps forbidden scope after a rename", () => {
    const copy = formatUnbindableTemplateInputsText(findUnbindableTemplateInputs(template));
    expect(copy.split("\n")).toEqual([
      "The Removal template has 10 components noma cannot submit.",
      "Biomass transportation to processing site via truck (rtc_1KWKNGJZY1S0D548; blueprint transport; input distance) and Biochar transportation to storage site via truck (rtc_1KWKNGJZY1S032A6; blueprint transport; input distance): Replace each one with a Mass-distance-based CI emissions component in Isometric, or pick another Removal template.",
      "Metered electricity use emissions (rtc_1KWKNGJZY1S0MEVJ; blueprint metered_energy_based_ci_emissions; inputs final_readout, initial_readout), Pyrolyzer CO emissions (rtc_1KWKNGJZY1S0VRJW; blueprint ghg_direct_emissions; inputs concentration, mass_flow), Pyrolyzer CH4 emissions (rtc_1KWKNGJZY1S0FDEH; blueprint ghg_direct_emissions; inputs concentration, mass_flow), Laboratory analysis electricity use (rtc_1KWKNGJZY1S0AC1G; blueprint grid_electricity_use; input electricity_use), Sampling consumables (rtc_1KWKNGJZY1S0Y0X5; blueprint mass_based_ci_emissions; input mass), Staff travel flights (rtc_1KWKNGJZY1S05AMF; blueprint distance_based_ci_emissions; input distance) and Staff travel local (rtc_1KWKNGJZY1S0RZG4; blueprint distance_based_ci_emissions; input distance): Pick another Removal template or ask support to add the mapping.",
      "Mass-based CI emissions (rtc_1KWKNGJZY1S0CMBS; blueprint mass_based_ci_emissions; input mass): Add it as a project component in Isometric, then remove it from the Removal template.",
    ]);
    expect(copy.match(/Metered electricity use emissions/g)).toHaveLength(1);
    expect(copy).toContain("blueprint ghg_direct_emissions; inputs concentration, mass_flow");
    const renamed = structuredClone(template);
    renamed.groups.find((group) => group.key === "miscellaneous")!.components[0].display_name = "Safety margin";
    expect(findUnbindableTemplateInputs(renamed).some((input) => input.componentId === "rtc_1KWKNGJZY1S0CMBS")).toBe(true);
  });

  it.each([false, true])("agrees with actual datapoint builds (sandbox stubs: %s)", (allowPeriodInputStub) => {
    const findings = findUnbindableTemplateInputs(template);
    for (const group of template.groups) for (const component of group.components) {
      for (const input of component.inputs) {
        if (input.type === "fixed") {
          expect(input.datapoint_id).toMatch(/^dtp_/);
          continue;
        }
        const accepted = acceptedInputs[`${component.id}/${input.input_key}`];
        const expected = expectedFindings.find(([id, key]) => id === component.id && (key === input.input_key || component.blueprint_key === "transport"));
        const contract = reviewedTemplateSources(template)[component.id];
        const shouldReject = contract.scope === "forbidden" || !!expected;
        const build = () => buildCreateDatapointRequest({
          groupKey: group.key,
          componentBlueprintKey: component.blueprint_key,
          componentDisplayName: component.display_name,
          lineContract: contract,
          rtcInput: input,
          // Snapshot has no complete REST blueprint metadata. Use explicit test
          // units for supported mappings; rejected tuples fail before unit checks.
          blueprintInput: { input_key: input.input_key, compatible_unit: accepted?.unit ?? "dimensionless", quantity_kind: input.quantity_kind, data_shape: "SCALAR", description: "" },
          agg, projectId: template.project_id, supplierRefId: "test-production-coverage", allowPeriodInputStub,
        });
        expect(findings.some((finding) => finding.componentId === component.id && (finding.inputKey === input.input_key || component.blueprint_key === "transport"))).toBe(shouldReject);
        if (shouldReject) {
          expect(build).toThrow(expected?.[2] === "project-scope" ? /belongs at the project level/ : /Pick another Removal template|pick another Removal template/);
        } else {
          expect(build().quantity.magnitude).toBe(accepted?.magnitude ?? 0);
        }
      }
    }
  });
});

function findUnbindableTemplateInputs(template: Parameters<typeof findCoverage>[0], options: Parameters<typeof findCoverage>[1] = {}) {
  return findCoverage(template, { lineSources: reviewedTemplateSources(template), ...options });
}
