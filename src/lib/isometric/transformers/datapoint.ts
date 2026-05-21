import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import type { AggregatedProductionData } from "../utils/aggregation";

type DatapointType = components["schemas"]["DatapointType"];
type QuantityKindType = components["schemas"]["QuantityKindType"];
type ComponentBlueprintInput = components["schemas"]["ComponentBlueprintInput"];
type RemovalTemplateComponentInput =
  components["schemas"]["RemovalTemplateComponentInput"];

export interface InputMappingEntry {
  source: keyof AggregatedProductionData;
  unit: string;
  datapointType: DatapointType;
  expectedQuantityKind: QuantityKindType;
  transform?: (value: number) => number;
  /**
   * Marks a deferred per-reporting-period input that currently emits a
   * hardcoded placeholder 0 because noma has no data model for it yet.
   * `submitCreditBatch` blocks submission to a production Isometric
   * project when any resolved monitored input carries this flag. Do NOT
   * set it on legitimate zeros (e.g. the `initial_readout` of a metered
   * consumption delta) — only on genuine placeholders. Tracked in
   * docs/open-questions.md → isometric/phase-3.7-period-inputs.
   */
  zeroStub?: true;
}

// Maps (group_key, blueprint_key, input_key) tuples to a noma aggregated
// source field. The 3-level structure is required because blueprints repeat
// across groups in real templates (e.g., the `transport` blueprint appears
// in both `biomass-feedstock-transport` and `biochar-transport` groups, with
// different semantic meaning). Group keys are stable kebab-case slugs from
// the template's RemovalTemplateComponentGroup.key field.
//
// Validated against the live blueprint at submit time (see
// buildCreateDatapointRequest) so a key that drifts from the catalog
// surfaces immediately rather than silently producing a malformed datapoint.
export type InputMappingTable = Record<
  string,
  Record<string, Record<string, InputMappingEntry>>
>;

export const INPUT_MAPPING: InputMappingTable = {
  // CO₂ stored from biochar application
  "co2-stored": {
    carbon_rich_substance_sequestration: {
      // Demo template declares carbon_content as dimensionless (a 0–1 fraction).
      // samples.organicCarbonPercent is 0–100, so transform converts before emit.
      carbon_content: {
        source: "weightedOrganicCarbonPercent",
        unit: "dimensionless",
        datapointType: "REPORTED",
        expectedQuantityKind: "dimensionless",
        transform: (v) => v / 100,
      },
      product_mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
      },
    },
  },

  // Biomass → processing transport (feedstock leg category)
  "biomass-feedstock-transport": {
    transport: {
      distance: {
        source: "feedstockTransportAvgDistanceKm",
        unit: "km",
        datapointType: "REPORTED",
        expectedQuantityKind: "distance",
      },
      mass: {
        source: "totalFeedstockDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
      },
    },
    specific_volume_based_emissions: {
      feedstock_mass: {
        source: "totalFeedstockDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
      },
    },
  },

  // Biochar → storage transport (delivery leg category)
  "biochar-transport": {
    transport: {
      distance: {
        source: "biocharTransportAvgDistanceKm",
        unit: "km",
        datapointType: "REPORTED",
        expectedQuantityKind: "distance",
      },
      mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
      },
    },
    specific_volume_based_emissions: {
      feedstock_mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
      },
    },
  },

  // Sample shipping to lab.
  "sampling-required-for-mrv": {
    distance_based_ci_emissions: {
      distance: {
        source: "sampleTransportAvgDistanceKm",
        unit: "km",
        datapointType: "REPORTED",
        expectedQuantityKind: "distance",
      },
    },
    // Zero stub — sampling consumables mass. noma has no per-period
    // consumables figure; deferred per-period input (see Phase 3.7 +
    // `docs/open-questions.md` → `isometric/phase-3.7-period-inputs`).
    mass_based_ci_emissions: {
      mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
        transform: () => 0,
        zeroStub: true,
      },
    },
    // Zero stub — lab-analysis electricity. Deferred per-period input.
    grid_electricity_use: {
      electricity_use: {
        source: "totalBiocharDryMassKg",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
        transform: () => 0,
        zeroStub: true,
      },
    },
    // Real (Phase 3.7) — sample shipment to the lab as mass-distance
    // (tonne·km), derived from the sample transport legs by
    // `enrichWithTransportLegs`. 0 when no sample legs.
    mass_distance_based_ci_emissions: {
      mass_distance: {
        source: "sampleTransportMassDistanceTonneKm",
        unit: "tonne * km",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass_distance",
      },
    },
  },

  // Biochar processing energy (Phase 3.7). Grid electricity = the
  // biochar-stage share of the run's combined `electricity_kwh`; genset
  // = the biochar-stage share of genset diesel converted to kWh. Both
  // shares come from `enrichWithFacilityConfig`.
  "biochar-processing": {
    grid_electricity_use: {
      electricity_use: {
        source: "biocharElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
    energy_based_ci_emissions: {
      energy: {
        source: "biocharGensetKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
  },

  // Pyrolysis energy (Phase 3.7). Certify's
  // `metered_energy_based_ci_emissions` computes consumption as
  // `final − initial`; noma has only the consumption delta, so
  // initial_readout = 0 and final_readout = the pyrolysis-stage share
  // of the run's combined electricity. Genset = pyrolysis-stage share
  // of genset diesel as kWh. Shares from `enrichWithFacilityConfig`.
  pyrolysis: {
    metered_energy_based_ci_emissions: {
      initial_readout: {
        source: "pyrolysisElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
        transform: () => 0,
      },
      final_readout: {
        source: "pyrolysisElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
    energy_based_ci_emissions: {
      energy: {
        source: "pyrolysisGensetKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
  },

  // ─── Remaining zero stubs — deferred per-period inputs ───
  // Phase 3.7 closed the energy stubs (electricity + genset, now real
  // per-run data routed via `enrichWithFacilityConfig`). What remains
  // below are *per-reporting-period* inputs noma has no model for yet —
  // pyrolyzer gas (CH4/CO concentration + mass flow), staff travel, lab
  // electricity, sampling consumables, miscellaneous mass. They still
  // emit a `0` datapoint with the unit + quantity_kind the blueprint
  // declares. EACH must be replaced before the template moves to a
  // production project. Tracked in `docs/open-questions.md` →
  // `isometric/phase-3.7-period-inputs` (placement + apportionment
  // unresolved).
  //
  // Convention: reuse `totalBiocharDryMassKg` as the source (always a
  // finite non-null number after aggregation) and override with
  // `transform: () => 0`. The `expectedQuantityKind` still gates against
  // blueprint drift.
  "direct-emissions": {
    ghg_direct_emissions: {
      concentration: {
        source: "totalBiocharDryMassKg",
        unit: "mg / kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass_fraction",
        transform: () => 0,
        zeroStub: true,
      },
      mass_flow: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
        transform: () => 0,
        zeroStub: true,
      },
    },
  },
  "biochar-storage": {
    fuel_usage_by_volume: {
      volume_of_fuel: {
        source: "totalBiocharDryMassKg",
        unit: "L",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
        transform: () => 0,
        zeroStub: true,
      },
    },
  },
  "staff-travel": {
    distance_based_ci_emissions: {
      distance: {
        source: "totalBiocharDryMassKg",
        unit: "km",
        datapointType: "REPORTED",
        expectedQuantityKind: "distance",
        transform: () => 0,
        zeroStub: true,
      },
    },
  },

  // Startup / plant diesel — volume-based. `totalStartupDieselLitres`
  // excludes genset diesel (that flows through the energy-based genset
  // components above), so diesel is never double-counted.
  "biomass-feedstock-sourcing": {
    fuel_usage_by_volume: {
      volume_of_fuel: {
        source: "totalStartupDieselLitres",
        unit: "l",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
      },
    },
  },
  "biomass-feedstock-processing": {
    fuel_usage_by_volume: {
      volume_of_fuel: {
        source: "totalStartupDieselLitres",
        unit: "l",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
      },
    },
    // Biomass-stage metered electricity (Phase 3.7). Consumption delta
    // only, so initial_readout = 0 and final_readout = the biomass-stage
    // share of the run's combined electricity (from
    // `enrichWithFacilityConfig`).
    metered_energy_based_ci_emissions: {
      initial_readout: {
        source: "biomassElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
        transform: () => 0,
      },
      final_readout: {
        source: "biomassElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
    // Biomass-stage diesel genset (Phase 3.7) — biomass-stage share of
    // genset diesel converted to kWh.
    energy_based_ci_emissions: {
      energy: {
        source: "biomassGensetKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
  },

  // Zero stub — generic miscellaneous mass-based CI. noma has no
  // corresponding entity; emits 0. Deferred per-period input (Phase 3.7).
  miscellaneous: {
    mass_based_ci_emissions: {
      mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
        transform: () => 0,
        zeroStub: true,
      },
    },
  },
};

export function lookupInputMapping(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): InputMappingEntry | undefined {
  return INPUT_MAPPING[groupKey]?.[blueprintKey]?.[inputKey];
}

export interface BuildCreateDatapointArgs {
  groupKey: string;
  componentBlueprintKey: string;
  rtcInput: RemovalTemplateComponentInput;
  blueprintInput: ComponentBlueprintInput;
  agg: AggregatedProductionData;
  projectId: string;
  supplierRefId: string;
}

export function buildCreateDatapointRequest(
  args: BuildCreateDatapointArgs,
): components["schemas"]["CreateDatapointRequest"] {
  const {
    groupKey,
    componentBlueprintKey,
    rtcInput,
    blueprintInput,
    agg,
    projectId,
    supplierRefId,
  } = args;
  const inputKey = rtcInput.input_key;

  const mapping = lookupInputMapping(groupKey, componentBlueprintKey, inputKey);
  if (!mapping) {
    throw new SafeError(
      `No INPUT_MAPPING entry for group="${groupKey}" blueprint="${componentBlueprintKey}" input="${inputKey}" — update transformers/datapoint.ts before submitting.`,
    );
  }
  if (mapping.expectedQuantityKind !== blueprintInput.quantity_kind) {
    throw new SafeError(
      `Input "${inputKey}": blueprint expects quantity_kind="${blueprintInput.quantity_kind}" but mapping declares "${mapping.expectedQuantityKind}". Update INPUT_MAPPING.`,
    );
  }
  if (
    mapping.unit.toLowerCase() !== blueprintInput.compatible_unit.toLowerCase()
  ) {
    throw new SafeError(
      `Input "${inputKey}": blueprint compatible_unit="${blueprintInput.compatible_unit}" but mapping declares "${mapping.unit}". Phase 3 requires exact match; unit conversion is a Phase 4 concern.`,
    );
  }

  const raw = agg[mapping.source];
  if (raw == null) {
    throw new SafeError(
      `Input "${inputKey}": aggregated source ${String(mapping.source)} is null. Cannot build datapoint.`,
    );
  }
  const magnitude = mapping.transform
    ? mapping.transform(raw as number)
    : (raw as number);

  return {
    description: `Aggregated from production runs ${agg.sourceProductionRunIds.join(", ")}`,
    display_name: blueprintInput.input_key,
    project_id: projectId,
    quantity: {
      magnitude,
      unit: mapping.unit,
    },
    source_ids: [],
    supplier_reference_id: supplierRefId,
    type: mapping.datapointType,
  };
}
