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

  // Sample shipping to lab
  "sampling-required-for-mrv": {
    distance_based_ci_emissions: {
      distance: {
        source: "sampleTransportAvgDistanceKm",
        unit: "km",
        datapointType: "REPORTED",
        expectedQuantityKind: "distance",
      },
    },
    mass_based_ci_emissions: {
      mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
      },
    },
  },

  // Biochar processing electricity
  "biochar-processing": {
    grid_electricity_use: {
      electricity_use: {
        source: "totalElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
  },

  // Biomass handling / processing fuel
  "biomass-feedstock-sourcing": {
    fuel_usage_by_volume: {
      volume_of_fuel: {
        source: "totalDieselLiters",
        unit: "l",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
      },
    },
  },
  "biomass-feedstock-processing": {
    fuel_usage_by_volume: {
      volume_of_fuel: {
        source: "totalDieselLiters",
        unit: "l",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
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
