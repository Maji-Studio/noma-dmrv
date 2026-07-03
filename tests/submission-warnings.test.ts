/**
 * Non-blocking submission advisories (`buildSubmissionWarnings`).
 *
 * Issue #319: diesel submits as one combined litres datapoint through the
 * monitored `pyrolysis / fuel_usage_by_volume / volume_of_fuel` input, so the
 * advisory fires when a template lacks that monitored input in the pyrolysis
 * group while any run recorded diesel (mitigates silent under-reporting on
 * template drift — including a component whose volume input is fixed/prebound,
 * which resolveTemplateInputs would never feed from the runs).
 *
 * Issue #320 added the month-straddle advisory: §8.6.2 anchors the removal's
 * period end on the latest biochar application, so production in one UTC month
 * and application in a later one stretches the reporting window across months
 * — operations emissions "must be attributed to the Reporting Period in which
 * they occur", hence the warning (advisory only; splitting is the operator's
 * call).
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

function lineage(applicationDate: Date): {
  application: { applicationDate: Date };
} {
  return { application: { applicationDate } };
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

describe("buildSubmissionWarnings — unmapped diesel (issue #319)", () => {
  it("warns when genset diesel is recorded but the template has no fuel_usage_by_volume", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run({ dieselGensetLiters: 25 })],
      lineages: [],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/fuel-usage-by-volume/);
    expect(warnings[0]).toMatch(/cannot include these fuel emissions/);
  });

  it("warns when startup/preprocessing diesel is recorded without the component", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run({ dieselOperationLiters: 5, preprocessingFuelLiters: 3 })],
      lineages: [],
    });
    expect(warnings).toHaveLength(1);
  });

  it("stays silent when the pyrolysis group declares fuel_usage_by_volume", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITH_FUEL_COMPONENT,
      runs: [run({ dieselGensetLiters: 25, dieselOperationLiters: 5 })],
      lineages: [],
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
      lineages: [],
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
      lineages: [],
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
      lineages: [],
    });
    expect(warnings).toHaveLength(1);
  });

  it("stays silent when no diesel is recorded", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run()],
      lineages: [],
    });
    expect(warnings).toEqual([]);
  });

  it("returns no diesel warning without a default template", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: null,
      runs: [run({ dieselGensetLiters: 25 })],
      lineages: [],
    });
    expect(warnings).toEqual([]);
  });
});

describe("buildSubmissionWarnings — month straddle (issue #320)", () => {
  it("emits no straddle warning when production start and latest application share a UTC month", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run({ startTime: new Date("2026-01-05T00:00:00Z") })],
      lineages: [lineage(new Date("2026-01-28T00:00:00Z"))],
    });
    expect(warnings).toEqual([]);
  });

  it("warns when the latest application falls in a later UTC month than production start", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run({ startTime: new Date("2026-01-05T00:00:00Z") })],
      lineages: [
        lineage(new Date("2026-01-20T00:00:00Z")),
        lineage(new Date("2026-04-05T00:00:00Z")),
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("spans multiple months");
    expect(warnings[0]).toContain("2026-01");
    expect(warnings[0]).toContain("2026-04");
    expect(warnings[0]).toContain("§8.6.2");
  });

  it("warns across a year boundary (December production, January application)", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [run({ startTime: new Date("2025-12-20T00:00:00Z") })],
      lineages: [lineage(new Date("2026-01-03T00:00:00Z"))],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2025-12");
    expect(warnings[0]).toContain("2026-01");
  });

  it("anchors the straddle check on the EARLIEST run start and the LATEST application", () => {
    // Runs start Jan + Feb; applications Feb + Feb → straddle (Jan vs Feb),
    // even though the later run and both applications share February.
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [
        run({ startTime: new Date("2026-02-01T00:00:00Z") }),
        run({ startTime: new Date("2026-01-30T00:00:00Z") }),
      ],
      lineages: [
        lineage(new Date("2026-02-10T00:00:00Z")),
        lineage(new Date("2026-02-02T00:00:00Z")),
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("production started 2026-01");
    expect(warnings[0]).toContain("latest application 2026-02");
  });

  it("emits nothing without runs or lineages (nothing to compare)", () => {
    expect(
      buildSubmissionWarnings({
        defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
        runs: [],
        lineages: [lineage(new Date("2026-04-05T00:00:00Z"))],
      }),
    ).toEqual([]);
    expect(
      buildSubmissionWarnings({
        defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
        runs: [run({ startTime: new Date("2026-01-05T00:00:00Z") })],
        lineages: [],
      }),
    ).toEqual([]);
  });

  it("fires independently of the template (a straddle is a property of the dates alone)", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: null,
      runs: [run({ startTime: new Date("2026-01-05T00:00:00Z") })],
      lineages: [lineage(new Date("2026-02-05T00:00:00Z"))],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("spans multiple months");
  });
});

describe("buildSubmissionWarnings — combined advisories", () => {
  it("surfaces the unmapped-diesel advisory alongside a straddle warning", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [
        run({
          startTime: new Date("2026-01-05T00:00:00Z"),
          dieselOperationLiters: 12,
        }),
      ],
      lineages: [lineage(new Date("2026-02-05T00:00:00Z"))],
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("Diesel fuel");
    expect(warnings[1]).toContain("spans multiple months");
  });

  it("emits only the diesel advisory when the window stays within one month", () => {
    const warnings = buildSubmissionWarnings({
      defaultTemplate: TEMPLATE_WITHOUT_FUEL_COMPONENT,
      runs: [
        run({
          startTime: new Date("2026-01-05T00:00:00Z"),
          preprocessingFuelLiters: 3,
        }),
      ],
      lineages: [lineage(new Date("2026-01-25T00:00:00Z"))],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Diesel fuel");
  });
});
