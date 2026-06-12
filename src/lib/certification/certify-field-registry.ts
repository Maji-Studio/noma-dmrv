import type { AggregatedProductionData } from "@/lib/isometric/utils/aggregation";

export type CertifyEntityKind =
  | "productionRun"
  | "sample"
  | "feedstock"
  | "transportLeg"
  | "facilityEmissionConfig"
  | "delivery"
  | "application"
  | "customerLocation"
  | "supplier"
  | "supplierLocation";

export type CertifyFieldKind = "entered" | "derived";

export type AggregatedProductionSource = keyof AggregatedProductionData;

export interface CertifyInputTuple {
  groupKey: string;
  blueprintKey: string;
  inputKey: string;
}

export interface CertifySourceMapping {
  source: AggregatedProductionSource;
  inputTuples?: readonly CertifyInputTuple[];
}

export interface CertifyFieldCondition {
  field: string;
  equals: string | number | boolean | null;
  label: string;
}

export type CertifyFieldSatisfaction =
  | { mode: "field" }
  | { mode: "anyOf"; fields: readonly string[]; label: string };

export interface CertifyFieldDescriptor {
  key: string;
  label: string;
  kind: CertifyFieldKind;
  formFields?: readonly string[];
  condition?: CertifyFieldCondition;
  satisfaction?: CertifyFieldSatisfaction;
  mappings?: readonly CertifySourceMapping[];
}

export const AGGREGATED_PRODUCTION_DATA_KEYS = [
  "weightedOrganicCarbonPercent",
  "weightedHToCorgRatio",
  "weightedOToCorgRatio",
  "weightedAshPercent",
  "weightedMoisturePercent",
  "totalBiocharDryMassKg",
  "totalFeedstockDryMassKg",
  "totalStartupDieselLitres",
  "totalGensetDieselLitres",
  "totalElectricityKwh",
  "feedstockTransportAvgDistanceKm",
  "biocharTransportAvgDistanceKm",
  "sampleTransportAvgDistanceKm",
  "sampleTransportMassDistanceTonneKm",
  "biomassElectricityKwh",
  "pyrolysisElectricityKwh",
  "biocharElectricityKwh",
  "biomassGensetKwh",
  "pyrolysisGensetKwh",
  "biocharGensetKwh",
  "earliestStartTime",
  "latestEndTime",
  "sourceProductionRunIds",
  "warnings",
] as const satisfies readonly AggregatedProductionSource[];

const tuple = (
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): CertifyInputTuple => ({ groupKey, blueprintKey, inputKey });

const mapping = (
  source: AggregatedProductionSource,
  inputTuples?: readonly CertifyInputTuple[],
): CertifySourceMapping => ({ source, inputTuples });

const electricityStageMappings = [
  mapping("biomassElectricityKwh", [
    tuple(
      "biomass-feedstock-processing",
      "metered_energy_based_ci_emissions",
      "initial_readout",
    ),
    tuple(
      "biomass-feedstock-processing",
      "metered_energy_based_ci_emissions",
      "final_readout",
    ),
  ]),
  mapping("pyrolysisElectricityKwh", [
    tuple("pyrolysis", "metered_energy_based_ci_emissions", "initial_readout"),
    tuple("pyrolysis", "metered_energy_based_ci_emissions", "final_readout"),
  ]),
  mapping("biocharElectricityKwh", [
    tuple("biochar-processing", "grid_electricity_use", "electricity_use"),
  ]),
] as const;

const gensetStageMappings = [
  mapping("biomassGensetKwh", [
    tuple("biomass-feedstock-processing", "energy_based_ci_emissions", "energy"),
  ]),
  mapping("pyrolysisGensetKwh", [
    tuple("pyrolysis", "energy_based_ci_emissions", "energy"),
  ]),
  mapping("biocharGensetKwh", [
    tuple("biochar-processing", "energy_based_ci_emissions", "energy"),
  ]),
] as const;

const transportDistanceMappings = [
  mapping("feedstockTransportAvgDistanceKm", [
    tuple("biomass-feedstock-transport", "transport", "distance"),
  ]),
  mapping("biocharTransportAvgDistanceKm", [
    tuple("biochar-transport", "transport", "distance"),
  ]),
  mapping("sampleTransportAvgDistanceKm", [
    tuple("sampling-required-for-mrv", "distance_based_ci_emissions", "distance"),
  ]),
  mapping("sampleTransportMassDistanceTonneKm", [
    tuple(
      "sampling-required-for-mrv",
      "mass_distance_based_ci_emissions",
      "mass_distance",
    ),
  ]),
] as const;

const transportMassMappings = [
  mapping("sampleTransportMassDistanceTonneKm", [
    tuple(
      "sampling-required-for-mrv",
      "mass_distance_based_ci_emissions",
      "mass_distance",
    ),
  ]),
] as const;

export const CERTIFY_FIELD_REGISTRY: Record<
  CertifyEntityKind,
  readonly CertifyFieldDescriptor[]
> = {
  productionRun: [
    {
      key: "feedstockWetMassKg",
      label: "Feedstock wet mass",
      kind: "entered",
      mappings: [
        mapping("totalFeedstockDryMassKg", [
          tuple("biomass-feedstock-transport", "transport", "mass"),
          tuple(
            "biomass-feedstock-transport",
            "specific_volume_based_emissions",
            "feedstock_mass",
          ),
        ]),
      ],
    },
    {
      key: "feedstockMoisturePercent",
      label: "Feedstock moisture",
      kind: "entered",
      mappings: [mapping("totalFeedstockDryMassKg")],
    },
    {
      key: "biocharOutputKg",
      label: "Biochar wet mass",
      kind: "entered",
      mappings: [
        mapping("totalBiocharDryMassKg", [
          tuple("co2-stored", "carbon_rich_substance_sequestration", "product_mass"),
          tuple("biochar-transport", "transport", "mass"),
          tuple(
            "biochar-transport",
            "specific_volume_based_emissions",
            "feedstock_mass",
          ),
        ]),
      ],
    },
    {
      key: "biocharMoisturePercent",
      label: "Biochar moisture",
      kind: "entered",
      mappings: [mapping("totalBiocharDryMassKg")],
    },
    {
      key: "dieselOperationLiters",
      label: "Operation diesel",
      kind: "entered",
      mappings: [
        mapping("totalStartupDieselLitres", [
          tuple(
            "biomass-feedstock-sourcing",
            "fuel_usage_by_volume",
            "volume_of_fuel",
          ),
          tuple(
            "biomass-feedstock-processing",
            "fuel_usage_by_volume",
            "volume_of_fuel",
          ),
        ]),
      ],
    },
    {
      key: "preprocessingFuelLiters",
      label: "Preprocessing fuel",
      kind: "entered",
      mappings: [mapping("totalStartupDieselLitres")],
    },
    {
      key: "dieselGensetLiters",
      label: "Genset diesel",
      kind: "entered",
      mappings: [
        mapping("totalGensetDieselLitres"),
        ...gensetStageMappings,
      ],
    },
    {
      key: "electricityKwh",
      label: "Electricity",
      kind: "entered",
      mappings: [
        mapping("totalElectricityKwh"),
        ...electricityStageMappings,
      ],
    },
  ],
  sample: [
    {
      key: "organicCarbonPercent",
      label: "Organic carbon",
      kind: "entered",
      mappings: [
        mapping("weightedOrganicCarbonPercent", [
          tuple("co2-stored", "carbon_rich_substance_sequestration", "carbon_content"),
        ]),
      ],
    },
    {
      key: "hToCOrgRatio",
      label: "H:Corg ratio",
      kind: "entered",
      mappings: [mapping("weightedHToCorgRatio")],
    },
    {
      key: "tgaNonReactiveCarbonData",
      label: "TGA non-reactive carbon data",
      kind: "entered",
      formFields: ["reactiveCarbonPercent", "residualCarbonPercent"],
      condition: {
        field: "durabilityOption",
        equals: "1000_year",
        label: "1000-year durability",
      },
      satisfaction: {
        mode: "anyOf",
        fields: ["reactiveCarbonPercent", "residualCarbonPercent"],
        label: "Reactive or residual carbon percent",
      },
    },
    {
      key: "randomReflectanceR0Percent",
      label: "R0 reflectance",
      kind: "entered",
      condition: {
        field: "durabilityOption",
        equals: "1000_year",
        label: "1000-year durability",
      },
    },
  ],
  feedstock: [
    {
      // Form field `totalWetMassKg` persists as `massWetKg`; `satisfaction`
      // checks the entity column while `formFields` drives the form badge.
      // The wet mass becomes the auto-derived feedstock leg's load mass
      // (data-access/feedstocks.ts → syncFeedstockTransportLeg).
      key: "massWetKg",
      label: "Feedstock wet mass",
      kind: "entered",
      formFields: ["totalWetMassKg"],
      satisfaction: {
        mode: "anyOf",
        fields: ["massWetKg"],
        label: "Feedstock wet mass",
      },
      mappings: [mapping("feedstockTransportAvgDistanceKm")],
    },
    {
      key: "transportLeg",
      label: "Feedstock transport leg",
      kind: "derived",
      // The derived leg's distance resolves form override → supplier default
      // location → supplier-level distance; badge the form-side override.
      formFields: ["transportDistanceKm"],
      mappings: [mapping("feedstockTransportAvgDistanceKm")],
    },
  ],
  transportLeg: [
    {
      key: "distanceKm",
      label: "Transport distance",
      kind: "entered",
      mappings: transportDistanceMappings,
    },
    {
      key: "loadMassKg",
      label: "Load mass",
      kind: "entered",
      mappings: [
        mapping("feedstockTransportAvgDistanceKm"),
        mapping("biocharTransportAvgDistanceKm"),
        mapping("sampleTransportAvgDistanceKm"),
        ...transportMassMappings,
      ],
    },
  ],
  facilityEmissionConfig: [
    {
      key: "gensetEnergyYieldKwhPerLitre",
      label: "Genset energy yield",
      kind: "entered",
      mappings: gensetStageMappings,
    },
    {
      key: "stageSplitBiomassPct",
      label: "Biomass stage split",
      kind: "entered",
      mappings: [
        mapping("biomassElectricityKwh"),
        mapping("biomassGensetKwh"),
      ],
    },
    {
      key: "stageSplitPyrolysisPct",
      label: "Pyrolysis stage split",
      kind: "entered",
      mappings: [
        mapping("pyrolysisElectricityKwh"),
        mapping("pyrolysisGensetKwh"),
      ],
    },
    {
      key: "stageSplitBiocharPct",
      label: "Biochar stage split",
      kind: "entered",
      mappings: [
        mapping("biocharElectricityKwh"),
        mapping("biocharGensetKwh"),
      ],
    },
  ],
  // The kinds below are badge/mapping documentation only — they are never fed
  // to `deriveEntityCertifyReadiness` (their gaps surface through the derived
  // transport legs and the CO2e-stored preview instead).
  delivery: [
    {
      // The truck weighbridge masses are the measurement method; this is the
      // submitted value — it becomes the auto-derived biochar distribution
      // leg's load mass (data-access/transport-legs.ts →
      // syncBiocharProductTransportLeg).
      key: "deliveredWetMassKg",
      label: "Delivered wet mass",
      kind: "entered",
      mappings: [mapping("biocharTransportAvgDistanceKm")],
    },
  ],
  application: [
    // Carbon inputs for the CO2e-stored calculation
    // (lib/calculations/biochar-removal.ts → computeApplicationCo2eStored):
    // dry mass derives from wet mass × the delivery's moisture, falling back
    // to the manual dry entry when the delivery has no moisture data.
    {
      key: "biocharAppliedTons",
      label: "Applied biochar wet mass",
      kind: "entered",
    },
    {
      key: "biocharAppliedDryTons",
      label: "Applied biochar dry mass",
      kind: "entered",
    },
    {
      key: "soilTemperatureC",
      label: "Soil temperature",
      kind: "entered",
    },
  ],
  customerLocation: [
    {
      // Stored default distance for the auto-derived biochar distribution
      // leg (a per-delivery `distanceKmOverride` beats it when set).
      key: "distanceFromFacilityKm",
      label: "Distance from facility",
      kind: "entered",
      mappings: [mapping("biocharTransportAvgDistanceKm")],
    },
  ],
  supplier: [
    {
      // Supplier-level fallback distance for the auto-derived feedstock leg.
      key: "distanceToFacilityKm",
      label: "Distance to facility",
      kind: "entered",
      mappings: [mapping("feedstockTransportAvgDistanceKm")],
    },
  ],
  supplierLocation: [
    {
      // Default-location distance — the preferred stored level for the
      // auto-derived feedstock leg.
      key: "distanceFromFacilityKm",
      label: "Distance from facility",
      kind: "entered",
      mappings: [mapping("feedstockTransportAvgDistanceKm")],
    },
  ],
} as const;

export function getCertifyFieldDescriptors(
  entityKind: CertifyEntityKind,
): readonly CertifyFieldDescriptor[] {
  return CERTIFY_FIELD_REGISTRY[entityKind];
}

export function getCertifyFieldDescriptor(
  entityKind: CertifyEntityKind,
  key: string,
): CertifyFieldDescriptor | undefined {
  return CERTIFY_FIELD_REGISTRY[entityKind].find((field) => field.key === key);
}

export function isCertifyFormField(
  entityKind: CertifyEntityKind,
  fieldName: string,
): boolean {
  return CERTIFY_FIELD_REGISTRY[entityKind].some((field) => {
    // Derived descriptors badge only the explicitly-named form inputs that
    // feed the derivation; entered descriptors default to their own key.
    const formFields =
      field.formFields ?? (field.kind === "entered" ? [field.key] : []);
    return formFields.includes(fieldName);
  });
}
