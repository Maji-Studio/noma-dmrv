import { describe, expect, it } from "vitest";
import type { components } from "@/lib/isometric/generated/certify";
import {
  buildCreateDatapointRequest,
  lookupInputMapping,
} from "@/lib/isometric/transformers/datapoint";
import { buildCreateGhgEntryRequest } from "@/lib/isometric/transformers/ghg-entry";
import type { AggregatedProductionData } from "@/lib/isometric/utils/aggregation";

type ComponentBlueprint = components["schemas"]["ComponentBlueprint"];
type ComponentBlueprintInput = components["schemas"]["ComponentBlueprintInput"];
type GhgEntryTemplate = components["schemas"]["GhgEntryTemplate"];
type GhgEntryTemplateComponentInput =
  components["schemas"]["GhgEntryTemplateComponentInput"];

const PROJECT_ID = "prj_TEST";
const SUPPLIER_REF = "nm-test-001";

// Group + blueprint pairs the tests anchor against. Mirrors the real-template
// disambiguation introduced when INPUT_MAPPING moved from flat to three-level.
const CO2_STORED = {
  groupKey: "co2-stored",
  blueprintKey: "carbon_rich_substance_sequestration",
} as const;
// Energy enters at a single pyrolysis measurement point (ADR 0015, amended by
// issue #319): one grid electricity datapoint (kWh) and one combined diesel
// datapoint (litres, `fuel_usage_by_volume` — the EF is template-side).
const PYROLYSIS_ELECTRICITY = {
  groupKey: "pyrolysis",
  blueprintKey: "grid_electricity_use",
} as const;
const PYROLYSIS_FUEL_VOLUME = {
  groupKey: "pyrolysis",
  blueprintKey: "fuel_usage_by_volume",
} as const;
const baseAgg: AggregatedProductionData = {
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

function blueprintInput(
  overrides: Partial<ComponentBlueprintInput>,
): ComponentBlueprintInput {
  return {
    compatible_unit: "kg",
    data_shape: "SCALAR",
    description: "test input",
    input_key: "mass",
    quantity_kind: "mass",
    ...overrides,
  };
}

function rtcInput(
  overrides: Partial<GhgEntryTemplateComponentInput>,
): GhgEntryTemplateComponentInput {
  return {
    datapoint_id: null,
    display_name: "Test input",
    input_key: "mass",
    quantity_kind: "mass",
    type: "monitored",
    ...overrides,
  };
}

describe("buildCreateDatapointRequest", () => {
  it("emits a CreateDatapointRequest matching the blueprint input for a straightforward mass mapping", () => {
    const result = buildCreateDatapointRequest({
      groupKey: CO2_STORED.groupKey,
      componentBlueprintKey: CO2_STORED.blueprintKey,
      rtcInput: rtcInput({ input_key: "product_mass", quantity_kind: "mass" }),
      blueprintInput: blueprintInput({
        input_key: "product_mass",
        compatible_unit: "kg",
        quantity_kind: "mass",
      }),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    expect(result.project_id).toBe(PROJECT_ID);
    expect(result.supplier_reference_id).toBe(SUPPLIER_REF);
    expect(result.type).toBe("REPORTED");
    expect(result.quantity).toEqual({ magnitude: 1000, unit: "kg" });
    expect(result.source_ids).toEqual([]);
    expect(result.display_name).toBe("product_mass");
    expect(result.description).toContain("pr_1, pr_2");
  });

  it("applies the /100 transform for carbon_content (percent → fraction)", () => {
    // samples.organicCarbonPercent stored as 0–100; blueprint expects 0–1.
    const result = buildCreateDatapointRequest({
      groupKey: CO2_STORED.groupKey,
      componentBlueprintKey: CO2_STORED.blueprintKey,
      rtcInput: rtcInput({
        input_key: "carbon_content",
        quantity_kind: "dimensionless",
      }),
      blueprintInput: blueprintInput({
        input_key: "carbon_content",
        compatible_unit: "dimensionless",
        quantity_kind: "dimensionless",
      }),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    expect(result.quantity).toEqual({ magnitude: 0.8, unit: "dimensionless" });
  });

  it("matches units case-insensitively (kWh ↔ kwh)", () => {
    const result = buildCreateDatapointRequest({
      groupKey: PYROLYSIS_ELECTRICITY.groupKey,
      componentBlueprintKey: PYROLYSIS_ELECTRICITY.blueprintKey,
      rtcInput: rtcInput({
        input_key: "electricity_use",
        quantity_kind: "energy",
      }),
      blueprintInput: blueprintInput({
        input_key: "electricity_use",
        compatible_unit: "kwh",
        quantity_kind: "energy",
      }),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    // Combined grid electricity (totalElectricityKwh), no per-stage split.
    expect(result.quantity.unit).toBe("kWh");
    expect(result.quantity.magnitude).toBe(200);
  });

  it("maps pyrolysis fuel volume to the combined totalDieselLitres (issue #319)", () => {
    // Genset + startup diesel submit as ONE litres datapoint through
    // fuel_usage_by_volume; the volumetric EF is a fixed input pre-bound on
    // the Isometric template. No litres→kWh conversion anywhere.
    const result = buildCreateDatapointRequest({
      groupKey: PYROLYSIS_FUEL_VOLUME.groupKey,
      componentBlueprintKey: PYROLYSIS_FUEL_VOLUME.blueprintKey,
      rtcInput: rtcInput({
        input_key: "volume_of_fuel",
        quantity_kind: "volume",
      }),
      blueprintInput: blueprintInput({
        input_key: "volume_of_fuel",
        compatible_unit: "l",
        quantity_kind: "volume",
      }),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    // 50 startup + 20 genset = 70 combined litres.
    expect(result.quantity).toEqual({ magnitude: 70, unit: "l" });
    expect(result.type).toBe("REPORTED");
  });

  it("rejects an unknown (group, blueprint, input) tuple with a SafeError pointing to the mapping file", () => {
    expect(() =>
      buildCreateDatapointRequest({
        groupKey: CO2_STORED.groupKey,
        componentBlueprintKey: CO2_STORED.blueprintKey,
        rtcInput: rtcInput({
          input_key: "unmapped_input",
          quantity_kind: "mass",
        }),
        blueprintInput: blueprintInput({ input_key: "unmapped_input" }),
        agg: baseAgg,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/transformers\/datapoint\.ts/);
  });

  it("rejects when only the group_key differs (same blueprint+input, wrong group)", () => {
    // `mass_distance` exists under each transport group in INPUT_MAPPING but
    // only with the `mass_distance_based_ci_emissions` blueprint. A bogus
    // group_key must miss.
    expect(() =>
      buildCreateDatapointRequest({
        groupKey: "nonexistent-group",
        componentBlueprintKey: "mass_distance_based_ci_emissions",
        rtcInput: rtcInput({
          input_key: "mass_distance",
          quantity_kind: "mass_distance",
        }),
        blueprintInput: blueprintInput({
          input_key: "mass_distance",
          compatible_unit: "tonne * km",
          quantity_kind: "mass_distance",
        }),
        agg: baseAgg,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/No INPUT_MAPPING entry for group="nonexistent-group"/);
  });

  it("disambiguates `mass_distance` between feedstock and biochar transport groups", () => {
    // Same blueprint (`mass_distance_based_ci_emissions`), same input_key
    // (`mass_distance`), different groups resolve to different aggregated
    // sources (the per-category mass-weighted tonne·km).
    const feedstockMassDistance = buildCreateDatapointRequest({
      groupKey: "biomass-feedstock-transport",
      componentBlueprintKey: "mass_distance_based_ci_emissions",
      rtcInput: rtcInput({
        input_key: "mass_distance",
        quantity_kind: "mass_distance",
      }),
      blueprintInput: blueprintInput({
        input_key: "mass_distance",
        compatible_unit: "tonne * km",
        quantity_kind: "mass_distance",
      }),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });
    const biocharMassDistance = buildCreateDatapointRequest({
      groupKey: "biochar-transport",
      componentBlueprintKey: "mass_distance_based_ci_emissions",
      rtcInput: rtcInput({
        input_key: "mass_distance",
        quantity_kind: "mass_distance",
      }),
      blueprintInput: blueprintInput({
        input_key: "mass_distance",
        compatible_unit: "tonne * km",
        quantity_kind: "mass_distance",
      }),
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });
    // baseAgg has feedstockTransportMassDistanceTonneKm=50,
    // biocharTransportMassDistanceTonneKm=100.
    expect(feedstockMassDistance.quantity.magnitude).toBe(50);
    expect(biocharMassDistance.quantity.magnitude).toBe(100);
  });

  it("rejects a quantity_kind drift between mapping and live blueprint", () => {
    // Mapping declares product_mass as `mass`; pretend the catalog drifted to `volume`.
    expect(() =>
      buildCreateDatapointRequest({
        groupKey: CO2_STORED.groupKey,
        componentBlueprintKey: CO2_STORED.blueprintKey,
        rtcInput: rtcInput({
          input_key: "product_mass",
          quantity_kind: "volume",
        }),
        blueprintInput: blueprintInput({
          input_key: "product_mass",
          compatible_unit: "kg",
          quantity_kind: "volume",
        }),
        agg: baseAgg,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/quantity_kind/);
  });

  it("rejects a unit mismatch (Phase 3 requires exact match — no conversion)", () => {
    expect(() =>
      buildCreateDatapointRequest({
        groupKey: CO2_STORED.groupKey,
        componentBlueprintKey: CO2_STORED.blueprintKey,
        rtcInput: rtcInput({
          input_key: "product_mass",
          quantity_kind: "mass",
        }),
        blueprintInput: blueprintInput({
          input_key: "product_mass",
          compatible_unit: "g", // mapping declares "kg"
          quantity_kind: "mass",
        }),
        agg: baseAgg,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/Phase 3 requires exact match/);
  });

  it("rejects when the aggregated source value is null (cannot build datapoint)", () => {
    const aggMissing: AggregatedProductionData = {
      ...baseAgg,
      weightedOrganicCarbonPercent: null,
    };
    expect(() =>
      buildCreateDatapointRequest({
        groupKey: CO2_STORED.groupKey,
        componentBlueprintKey: CO2_STORED.blueprintKey,
        rtcInput: rtcInput({
          input_key: "carbon_content",
          quantity_kind: "dimensionless",
        }),
        blueprintInput: blueprintInput({
          input_key: "carbon_content",
          compatible_unit: "dimensionless",
          quantity_kind: "dimensionless",
        }),
        agg: aggMissing,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/null/);
  });

  it("INPUT_MAPPING covers the MVP demo-template (group, blueprint, input) tuples", () => {
    // Sanity: any deletion here is a real schema change, not a refactor.
    // Anchors the contract with the noma-mvp tailored template authored in
    // `docs/isometric/sandbox-template-authoring.md`. The seven previously-
    // zero-stubbed families moved to PROJECT scope under ADR 0005; their
    // coverage lives in `tests/period-input-tuples.test.ts`.
    const expected: Array<[string, string, string]> = [
      ["co2-stored", "carbon_rich_substance_sequestration", "carbon_content"],
      ["co2-stored", "carbon_rich_substance_sequestration", "product_mass"],
      // All three transport categories bind the `mass_distance_based_ci_emissions`
      // blueprint: a single mass-weighted `mass_distance` (tonne·km) per category
      // (there is no LIST-shaped transport blueprint in the Certify catalog).
      [
        "biomass-feedstock-transport",
        "mass_distance_based_ci_emissions",
        "mass_distance",
      ],
      ["biochar-transport", "mass_distance_based_ci_emissions", "mass_distance"],
      // Energy — single combined measurement point under pyrolysis (ADR 0015,
      // amended by issue #319): grid electricity → totalElectricityKwh, and
      // combined diesel litres → totalDieselLitres via fuel_usage_by_volume
      // (EF template-side). The former energy_based_ci_emissions genset entry
      // and the biomass-feedstock-sourcing / -processing fuel entries are gone
      // (the latter would double-count the combined litres).
      ["pyrolysis", "grid_electricity_use", "electricity_use"],
      ["pyrolysis", "fuel_usage_by_volume", "volume_of_fuel"],
      [
        "sampling-required-for-mrv",
        "mass_distance_based_ci_emissions",
        "mass_distance",
      ],
    ];
    for (const [groupKey, blueprintKey, inputKey] of expected) {
      expect(
        lookupInputMapping(groupKey, blueprintKey, inputKey),
      ).toBeDefined();
    }
  });
});

// --- buildCreateGhgEntryRequest ---

const blueprintMass: ComponentBlueprint = {
  description: "mass blueprint",
  display_name: "Mass",
  expressions: [],
  inputs: [
    blueprintInput({
      input_key: "mass",
      compatible_unit: "kg",
      quantity_kind: "mass",
      data_shape: "SCALAR",
    }),
  ],
  key: "mass_blueprint",
  type: "ACTIVITY",
};

const blueprintListInput: ComponentBlueprint = {
  description: "list blueprint",
  display_name: "List",
  expressions: [],
  inputs: [
    blueprintInput({
      input_key: "feedstock_mass",
      compatible_unit: "kg",
      quantity_kind: "mass",
      data_shape: "LIST",
    }),
  ],
  key: "list_blueprint",
  type: "ACTIVITY",
};

function template(
  components: { id: string; blueprint_key: string; inputs: { input_key: string }[] }[],
): GhgEntryTemplate {
  return {
    credit_type: "REMOVAL",
    display_name: "Test template",
    id: "rvt_TEST",
    project_id: PROJECT_ID,
    supplier_reference_id: null,
    groups: [
      {
        id: "rtg_1",
        key: "main",
        display_name: "Main group",
        description: "",
        components: components.map((c) => ({
          blueprint_key: c.blueprint_key,
          description: null,
          display_name: c.blueprint_key,
          id: c.id,
          inputs: c.inputs.map((i) =>
            rtcInput({ input_key: i.input_key, quantity_kind: "mass" }),
          ),
          ghg_entry_template_component_group_id: "rtg_1",
          ghg_entry_template_id: "rvt_TEST",
        })),
      },
    ],
  };
}

describe("buildCreateGhgEntryRequest", () => {
  it("assembles a CreateGhgEntryRequest with one scalar input wired to its datapoint", () => {
    const tmpl = template([
      { id: "rtc_A", blueprint_key: "mass_blueprint", inputs: [{ input_key: "mass" }] },
    ]);
    const blueprints = new Map([["mass_blueprint", blueprintMass]]);
    const datapointIds = new Map([["rtc_A::mass", "dtp_1"]]);

    const result = buildCreateGhgEntryRequest({
      template: tmpl,
      blueprintsByKey: blueprints,
      datapointIdsByRtcInput: datapointIds,
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    expect(result.project_id).toBe(PROJECT_ID);
    expect(result.ghg_entry_template_id).toBe("rvt_TEST");
    expect(result.supplier_reference_id).toBe(SUPPLIER_REF);
    expect(result.started_on).toBe("2026-01-01");
    expect(result.completed_on).toBe("2026-01-31");

    const components = result.ghg_entry_template_components ?? [];
    expect(components).toHaveLength(1);
    const comp = components[0]!;
    expect(comp.ghg_entry_template_component_id).toBe("rtc_A");
    expect(comp.inputs).toHaveLength(1);
    const input = comp.inputs[0]!;
    expect(input.__typename).toBe("CreateComponentScalarInput");
    if (input.__typename === "CreateComponentScalarInput") {
      expect(input.datapoint_id).toBe("dtp_1");
      expect(input.input_key).toBe("mass");
    }
  });

  it("emits CreateComponentListInput when the blueprint declares data_shape=LIST", () => {
    const tmpl = template([
      {
        id: "rtc_L",
        blueprint_key: "list_blueprint",
        inputs: [{ input_key: "feedstock_mass" }],
      },
    ]);
    const blueprints = new Map([["list_blueprint", blueprintListInput]]);
    const datapointIds = new Map([["rtc_L::feedstock_mass", "dtp_99"]]);

    const result = buildCreateGhgEntryRequest({
      template: tmpl,
      blueprintsByKey: blueprints,
      datapointIdsByRtcInput: datapointIds,
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    const components = result.ghg_entry_template_components ?? [];
    const input = components[0]!.inputs[0]!;
    expect(input.__typename).toBe("CreateComponentListInput");
    if (input.__typename === "CreateComponentListInput") {
      expect(input.datapoint_ids).toEqual(["dtp_99"]);
      expect(input.input_key).toBe("feedstock_mass");
    }
  });

  it("skips biochar_sequestration_200_year_* components (fed by the measurement-samples step)", () => {
    // The sequestration component carries no resolved datapoint and no catalog
    // blueprint here — both would throw if it weren't skipped. The normal
    // component must still be emitted.
    const tmpl = template([
      {
        id: "rtc_SEQ",
        blueprint_key: "biochar_sequestration_200_year_c_org",
        inputs: [{ input_key: "h_c_molar_ratios" }],
      },
      { id: "rtc_A", blueprint_key: "mass_blueprint", inputs: [{ input_key: "mass" }] },
    ]);
    const blueprints = new Map([["mass_blueprint", blueprintMass]]);
    const datapointIds = new Map([["rtc_A::mass", "dtp_1"]]);

    const result = buildCreateGhgEntryRequest({
      template: tmpl,
      blueprintsByKey: blueprints,
      datapointIdsByRtcInput: datapointIds,
      agg: baseAgg,
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    const components = result.ghg_entry_template_components ?? [];
    expect(components).toHaveLength(1);
    expect(components[0]!.ghg_entry_template_component_id).toBe("rtc_A");
  });

  it("throws when a component references a blueprint missing from the catalog (drift detection)", () => {
    const tmpl = template([
      { id: "rtc_X", blueprint_key: "missing_bp", inputs: [{ input_key: "mass" }] },
    ]);
    expect(() =>
      buildCreateGhgEntryRequest({
        template: tmpl,
        blueprintsByKey: new Map(),
        datapointIdsByRtcInput: new Map(),
        agg: baseAgg,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/missing from catalog/);
  });

  it("throws when an input_key references a blueprint input that doesn't exist", () => {
    const tmpl = template([
      {
        id: "rtc_A",
        blueprint_key: "mass_blueprint",
        inputs: [{ input_key: "nonexistent" }],
      },
    ]);
    const blueprints = new Map([["mass_blueprint", blueprintMass]]);

    expect(() =>
      buildCreateGhgEntryRequest({
        template: tmpl,
        blueprintsByKey: blueprints,
        datapointIdsByRtcInput: new Map(),
        agg: baseAgg,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/missing input "nonexistent"/);
  });

  it("throws when the orchestrator forgot to resolve a datapoint for a component input", () => {
    const tmpl = template([
      { id: "rtc_A", blueprint_key: "mass_blueprint", inputs: [{ input_key: "mass" }] },
    ]);
    const blueprints = new Map([["mass_blueprint", blueprintMass]]);

    expect(() =>
      buildCreateGhgEntryRequest({
        template: tmpl,
        blueprintsByKey: blueprints,
        datapointIdsByRtcInput: new Map(),
        agg: baseAgg,
        projectId: PROJECT_ID,
        supplierRefId: SUPPLIER_REF,
      }),
    ).toThrowError(/did not resolve a datapoint for component rtc_A/);
  });

  it("formats started_on / completed_on as ISO date (YYYY-MM-DD), stripping time", () => {
    const tmpl = template([
      { id: "rtc_A", blueprint_key: "mass_blueprint", inputs: [{ input_key: "mass" }] },
    ]);
    const result = buildCreateGhgEntryRequest({
      template: tmpl,
      blueprintsByKey: new Map([["mass_blueprint", blueprintMass]]),
      datapointIdsByRtcInput: new Map([["rtc_A::mass", "dtp_1"]]),
      agg: {
        ...baseAgg,
        earliestStartTime: new Date("2026-03-15T08:30:45Z"),
        latestEndTime: new Date("2026-04-02T17:00:00Z"),
      },
      projectId: PROJECT_ID,
      supplierRefId: SUPPLIER_REF,
    });

    expect(result.started_on).toBe("2026-03-15");
    expect(result.completed_on).toBe("2026-04-02");
  });
});
