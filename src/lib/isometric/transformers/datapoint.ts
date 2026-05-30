import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import type { AggregatedProductionData } from "../utils/aggregation";
import { payloadHash } from "../utils/payload-hash";

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

// Shared zero-magnitude transform for metered `initial_readout` inputs whose
// consumption delta starts from 0 (Certify's
// `metered_energy_based_ci_emissions` computes consumption as
// `final − initial`; noma has only the delta, so initial_readout = 0).
// Previously also paired with `zeroStub: true` on deferred per-period inputs;
// those families moved to PROJECT scope under ADR 0005.
const zeroTransform = () => 0;

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
    // Sampling consumables (`mass_based_ci_emissions`) and lab electricity
    // (`grid_electricity_use`) used to live here as zero stubs. Both moved
    // to PROJECT scope as Project Components per ADR 0005. If a template
    // declares either as a REMOVAL-scope component the scope-conflict
    // SafeError fires from PERIOD_INPUT_TUPLES below.
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
        transform: zeroTransform,
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

  // Five blueprint families that used to live here as zero stubs
  // (`staff-travel/distance_based_ci_emissions`,
  // `direct-emissions/ghg_direct_emissions` × 2 inputs,
  // `biochar-storage/fuel_usage_by_volume`,
  // `miscellaneous/mass_based_ci_emissions`) and two more under
  // `sampling-required-for-mrv` moved to PROJECT scope as Project
  // Components per ADR 0005. They are listed in PERIOD_INPUT_TUPLES below;
  // a Removal Template that declares any of them as REMOVAL-scope trips
  // the scope-conflict SafeError in buildCreateDatapointRequest.

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
        transform: zeroTransform,
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

  // (The previous `miscellaneous` zero-stub family moved to PROJECT scope
  // per ADR 0005.)
};

export function lookupInputMapping(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): InputMappingEntry | undefined {
  return INPUT_MAPPING[groupKey]?.[blueprintKey]?.[inputKey];
}

// Tuples that used to live in INPUT_MAPPING as `zeroStub: true` families
// before ADR 0005. Their data now lives as `PROJECT`-scope Components in
// Isometric (authored by the operator from a noma `/admin/emission-estimates`
// row); a Removal Template that declares any of them as REMOVAL-scope is
// wrong by construction. `buildCreateDatapointRequest` consults this set
// before the generic missing-entry error so the resulting `SafeError`
// names the canonical scope rather than just "missing mapping".
//
// Keys mirror the deleted entries exactly. Keep in sync with
// `CATEGORY_TO_BLUEPRINT` in
// `src/lib/isometric/utils/project-emission-match.ts` and the
// `projectEmissionCategory` pgEnum in `src/db/schema/common.ts`.
const PERIOD_INPUT_TUPLES: Record<
  string,
  Record<string, Record<string, { category: string }>>
> = {
  "staff-travel": {
    distance_based_ci_emissions: {
      distance: { category: "staff_travel" },
    },
  },
  "direct-emissions": {
    ghg_direct_emissions: {
      concentration: { category: "pyrolyzer_direct" },
      mass_flow: { category: "pyrolyzer_direct" },
    },
  },
  "biochar-storage": {
    fuel_usage_by_volume: {
      volume_of_fuel: { category: "biochar_storage_fuel" },
    },
  },
  miscellaneous: {
    mass_based_ci_emissions: {
      mass: { category: "miscellaneous" },
    },
  },
  "sampling-required-for-mrv": {
    mass_based_ci_emissions: {
      mass: { category: "sampling_consumables" },
    },
    grid_electricity_use: {
      electricity_use: { category: "lab_electricity" },
    },
  },
};

export function lookupPeriodInputTuple(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): { category: string } | undefined {
  return PERIOD_INPUT_TUPLES[groupKey]?.[blueprintKey]?.[inputKey];
}

// Sha256 hex of the canonical-JSON serialisation of INPUT_MAPPING. Computed
// once at module load and embedded in every submitRemoval-emitted
// payloadSnapshot + sync event so an Isometric-side issue correlates to a
// specific noma mapping revision (Plan §6 / B3). PROJECT-scope is omitted
// from this hash by design — those values don't flow through this table
// under Posture B (ADR 0005).
export const MAPPING_REVISION: string = payloadHash(INPUT_MAPPING);

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
    // ADR 0005 §3 — scope-conflict check fires BEFORE the generic
    // missing-entry error. If a template declares a period-input tuple
    // as REMOVAL-scope, the error names the canonical scope (PROJECT)
    // and points the operator at /admin/emission-estimates rather than
    // leaving them with a generic "missing mapping" message.
    const periodTuple = lookupPeriodInputTuple(
      groupKey,
      componentBlueprintKey,
      inputKey,
    );
    if (periodTuple) {
      throw new SafeError(
        `This input belongs to a Project-scope Component (PROJECT scope, category="${periodTuple.category}"). ` +
          `Remove "${groupKey}/${componentBlueprintKey}/${inputKey}" from the Removal Template; the corresponding emission is tracked as a Project Component published in the Isometric UI from a row in /admin/emission-estimates (ADR 0005).`,
      );
    }
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
