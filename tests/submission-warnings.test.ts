/**
 * buildSubmissionWarnings — the non-blocking advisory for recorded diesel
 * (genset or startup/preprocessing) the active removal template cannot carry.
 * Issue #319: diesel submits as one combined litres datapoint through the
 * `pyrolysis / fuel_usage_by_volume` component, so the advisory fires when a
 * template declares no such component in the pyrolysis group while any run
 * recorded diesel (mitigates silent under-reporting on template drift).
 */
import { describe, expect, it } from "vitest";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import { buildSubmissionWarnings } from "@/fn/certification/submission-warnings";

function template(
  groups: Array<{ key: string; blueprintKeys: string[] }>,
): IsometricGhgEntryTemplate {
  return {
    id: "rvt_TEST",
    display_name: "Test template",
    credit_type: "REMOVAL",
    groups: groups.map((group, gi) => ({
      id: `grp-${gi}`,
      key: group.key,
      display_name: group.key,
      components: group.blueprintKeys.map((blueprintKey, ci) => ({
        id: `rtc-${gi}-${ci}`,
        blueprint_key: blueprintKey,
        display_name: blueprintKey,
        inputs: [],
      })),
    })),
  } as unknown as IsometricGhgEntryTemplate;
}

function run(
  overrides: Partial<Record<string, unknown>> = {},
): ProductionRunWithSamples {
  return {
    id: "run-1",
    code: "RUN-1",
    dieselOperationLiters: 0,
    preprocessingFuelLiters: 0,
    dieselGensetLiters: 0,
    samples: [],
    readingsCount: 0,
    ...overrides,
  } as unknown as ProductionRunWithSamples;
}

const TEMPLATE_WITHOUT_FUEL_COMPONENT = template([
  { key: "pyrolysis", blueprintKeys: ["grid_electricity_use"] },
]);
const TEMPLATE_WITH_FUEL_COMPONENT = template([
  {
    key: "pyrolysis",
    blueprintKeys: ["grid_electricity_use", "fuel_usage_by_volume"],
  },
]);

describe("buildSubmissionWarnings", () => {
  it("warns when genset diesel is recorded but the template has no fuel_usage_by_volume", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run({ dieselGensetLiters: 25 })],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/fuel-usage-by-volume/);
    expect(warnings[0]).toMatch(/not submitted/);
  });

  it("warns when startup/preprocessing diesel is recorded without the component", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run({ dieselOperationLiters: 5, preprocessingFuelLiters: 3 })],
    });
    expect(warnings).toHaveLength(1);
  });

  it("stays silent when the pyrolysis group declares fuel_usage_by_volume", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITH_FUEL_COMPONENT,
      runs: [run({ dieselGensetLiters: 25, dieselOperationLiters: 5 })],
    });
    expect(warnings).toEqual([]);
  });

  it("ignores a fuel_usage_by_volume declared outside the pyrolysis group (cannot carry run diesel)", () => {
    // INPUT_MAPPING only serves pyrolysis/fuel_usage_by_volume, so a component
    // in another group would not receive the combined litres — still warn.
    const warnings = buildSubmissionWarnings({
      defaultTemplate: template([
        { key: "pyrolysis", blueprintKeys: ["grid_electricity_use"] },
        { key: "biomass-feedstock-sourcing", blueprintKeys: ["fuel_usage_by_volume"] },
      ]),
      runs: [run({ dieselGensetLiters: 25 })],
    });
    expect(warnings).toHaveLength(1);
  });

  it("stays silent when no diesel is recorded", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run()],
    });
    expect(warnings).toEqual([]);
  });

  it("returns no warnings without a default template", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: null,
      runs: [run({ dieselGensetLiters: 25 })],
    });
    expect(warnings).toEqual([]);
  });
});
