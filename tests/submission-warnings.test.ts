/**
 * buildSubmissionWarnings — the non-blocking advisory for recorded diesel
 * (genset or startup/preprocessing) the active removal template cannot carry.
 * Issue #319: diesel submits as one combined litres datapoint through the
 * monitored `pyrolysis / fuel_usage_by_volume / volume_of_fuel` input, so the
 * advisory fires when a template lacks that monitored input in the pyrolysis
 * group while any run recorded diesel (mitigates silent under-reporting on
 * template drift — including a component whose volume input is fixed/prebound,
 * which resolveTemplateInputs would never feed from the runs).
 */
import { describe, expect, it } from "vitest";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import { buildSubmissionWarnings } from "@/fn/certification/submission-warnings";

interface ComponentSpec {
  blueprintKey: string;
  inputs?: Array<{ inputKey: string; type: "fixed" | "monitored" }>;
}

function template(
  groups: Array<{ key: string; components: ComponentSpec[] }>,
): IsometricGhgEntryTemplate {
  return {
    id: "rvt_TEST",
    display_name: "Test template",
    credit_type: "REMOVAL",
    groups: groups.map((group, gi) => ({
      id: `grp-${gi}`,
      key: group.key,
      display_name: group.key,
      components: group.components.map((component, ci) => ({
        id: `rtc-${gi}-${ci}`,
        blueprint_key: component.blueprintKey,
        display_name: component.blueprintKey,
        inputs: (component.inputs ?? []).map((input) => ({
          input_key: input.inputKey,
          display_name: input.inputKey,
          type: input.type,
          datapoint_id: input.type === "fixed" ? "dtp_FIXED" : null,
        })),
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
  { key: "pyrolysis", components: [{ blueprintKey: "grid_electricity_use" }] },
]);
const TEMPLATE_WITH_FUEL_COMPONENT = template([
  {
    key: "pyrolysis",
    components: [
      { blueprintKey: "grid_electricity_use" },
      {
        blueprintKey: "fuel_usage_by_volume",
        inputs: [
          { inputKey: "volume_of_fuel", type: "monitored" },
          { inputKey: "emission_factor", type: "fixed" },
        ],
      },
    ],
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
    expect(warnings[0]).toMatch(/cannot include these fuel emissions/);
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
        {
          key: "pyrolysis",
          components: [{ blueprintKey: "grid_electricity_use" }],
        },
        {
          key: "biomass-feedstock-sourcing",
          components: [
            {
              blueprintKey: "fuel_usage_by_volume",
              inputs: [{ inputKey: "volume_of_fuel", type: "monitored" }],
            },
          ],
        },
      ]),
      runs: [run({ dieselGensetLiters: 25 })],
    });
    expect(warnings).toHaveLength(1);
  });

  it("warns when the component's volume_of_fuel input is fixed (prebound — run diesel never submitted)", () => {
    // resolveTemplateInputs treats fixed inputs as prebound datapoints, so the
    // run-derived litres are replaced by the constant — the advisory must fire.
    const warnings = buildSubmissionWarnings({
      defaultTemplate: template([
        {
          key: "pyrolysis",
          components: [
            {
              blueprintKey: "fuel_usage_by_volume",
              inputs: [{ inputKey: "volume_of_fuel", type: "fixed" }],
            },
          ],
        },
      ]),
      runs: [run({ dieselGensetLiters: 25 })],
    });
    expect(warnings).toHaveLength(1);
  });

  it("warns when the component declares no volume_of_fuel input at all", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: template([
        {
          key: "pyrolysis",
          components: [
            {
              blueprintKey: "fuel_usage_by_volume",
              inputs: [{ inputKey: "emission_factor", type: "fixed" }],
            },
          ],
        },
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
