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

// Maps blueprint input_keys to a noma aggregated source field. Validated
// against the live blueprint at submit time (see buildCreateDatapointRequest)
// so a key that drifts from the catalog surfaces immediately rather than
// silently producing a malformed datapoint.
export const INPUT_MAPPING: Record<string, InputMappingEntry> = {
  // Demo project's Protocol default + Biochar templates declare carbon_content
  // as dimensionless (a 0–1 fraction), not a percent. samples.organicCarbonPercent
  // is 0–100, so the transform converts before emit.
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
  mass: {
    source: "totalBiocharDryMassKg",
    unit: "kg",
    datapointType: "REPORTED",
    expectedQuantityKind: "mass",
  },
  feedstock_mass: {
    source: "totalFeedstockDryMassKg",
    unit: "kg",
    datapointType: "REPORTED",
    expectedQuantityKind: "mass",
  },
  volume_of_fuel: {
    source: "totalDieselLiters",
    unit: "l",
    datapointType: "REPORTED",
    expectedQuantityKind: "volume",
  },
  electricity_use: {
    source: "totalElectricityKwh",
    unit: "kWh",
    datapointType: "REPORTED",
    expectedQuantityKind: "energy",
  },
  h_to_c_ratio: {
    source: "weightedHToCorgRatio",
    unit: "",
    datapointType: "REPORTED",
    expectedQuantityKind: "dimensionless_ratio",
  },
  o_to_c_ratio: {
    source: "weightedOToCorgRatio",
    unit: "",
    datapointType: "REPORTED",
    expectedQuantityKind: "dimensionless_ratio",
  },
  ash_content: {
    source: "weightedAshPercent",
    unit: "%",
    datapointType: "REPORTED",
    expectedQuantityKind: "mass_fraction",
  },
  moisture_content: {
    source: "weightedMoisturePercent",
    unit: "%",
    datapointType: "REPORTED",
    expectedQuantityKind: "mass_fraction",
  },
};

export interface BuildCreateDatapointArgs {
  rtcInput: RemovalTemplateComponentInput;
  blueprintInput: ComponentBlueprintInput;
  agg: AggregatedProductionData;
  projectId: string;
  supplierRefId: string;
}

export function buildCreateDatapointRequest(
  args: BuildCreateDatapointArgs,
): components["schemas"]["CreateDatapointRequest"] {
  const { rtcInput, blueprintInput, agg, projectId, supplierRefId } = args;
  const inputKey = rtcInput.input_key;

  const mapping = INPUT_MAPPING[inputKey];
  if (!mapping) {
    throw new SafeError(
      `No INPUT_MAPPING entry for blueprint input "${inputKey}" — update transformers/datapoint.ts before submitting.`,
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
