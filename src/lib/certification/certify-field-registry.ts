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
  | { mode: "allOf"; fields: readonly string[]; label: string }
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
  "totalDieselLitres",
  "totalElectricityKwh",
  "feedstockTransportMassDistanceTonneKm",
  "biocharTransportMassDistanceTonneKm",
  "sampleTransportMassDistanceTonneKm",
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

// Pyrolysis energy: one grid-electricity datapoint plus diesel volume via
// `fuel_usage_by_volume` (ADR 0015, amended by #319 then the generator/startup
// diesel split — docs/isometric/changes.md). The Dark Earth template declares
// two `fuel_usage_by_volume` components (generator + preprocessing vs. startup)
// sharing one fixed volumetric EF; datapoint.ts resolves each to its own
// source. `dieselFuelVolumeMapping` links the shared input tuple for badge
// traceability — the per-field source (startup vs. genset litres) is set on
// each descriptor.
const electricityMapping = mapping("totalElectricityKwh", [
  tuple("pyrolysis", "grid_electricity_use", "electricity_use"),
]);

const dieselFuelVolumeMapping = mapping("totalDieselLitres", [
  tuple("pyrolysis", "fuel_usage_by_volume", "volume_of_fuel"),
]);

// Each transport category submits a single `mass_distance` (tonne·km) datapoint
// = Σⱼ(distⱼ × massⱼ). Both a leg's distance AND its load mass feed that figure,
// so the transportLeg.distanceKm and .loadMassKg fields share these mappings.
const transportMassDistanceMappings = [
  mapping("feedstockTransportMassDistanceTonneKm", [
    tuple(
      "biomass-feedstock-transport",
      "mass_distance_based_ci_emissions",
      "mass_distance",
    ),
  ]),
  mapping("biocharTransportMassDistanceTonneKm", [
    tuple("biochar-transport", "mass_distance_based_ci_emissions", "mass_distance"),
  ]),
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
      // Reactor-startup / on-site plant diesel — its own pyrolysis
      // `fuel_usage_by_volume` component ("Startup diesel usage") →
      // totalStartupDieselLitres. Split from genset (docs/isometric/changes.md,
      // amends #319); all diesel is cert-relevant, so this now badges + gates.
      key: "dieselOperationLiters",
      label: "Startup / plant diesel",
      kind: "entered",
      mappings: [mapping("totalStartupDieselLitres"), dieselFuelVolumeMapping],
    },
    {
      // Preprocessing fuel rides with genset in the "Generator diesel usage"
      // ("summarized") component → totalGensetDieselLitres.
      key: "preprocessingFuelLiters",
      label: "Preprocess fuel",
      kind: "entered",
      mappings: [mapping("totalGensetDieselLitres"), dieselFuelVolumeMapping],
    },
    {
      key: "dieselGensetLiters",
      label: "Genset diesel",
      kind: "entered",
      mappings: [mapping("totalGensetDieselLitres"), dieselFuelVolumeMapping],
    },
    {
      key: "electricityKwh",
      label: "Electricity",
      kind: "entered",
      mappings: [electricityMapping],
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
    {
      key: "sReflectanceFraction",
      label: "R₀ readings at or above 2%",
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
      mappings: [mapping("feedstockTransportMassDistanceTonneKm")],
    },
    {
      key: "transportLeg",
      label: "Feedstock transport leg",
      kind: "derived",
      // The derived leg's distance resolves form override → supplier default
      // location → supplier-level distance; badge the form-side override.
      formFields: ["transportDistanceKm"],
      mappings: [mapping("feedstockTransportMassDistanceTonneKm")],
    },
  ],
  transportLeg: [
    {
      key: "distanceKm",
      label: "Transport distance",
      kind: "entered",
      mappings: transportMassDistanceMappings,
    },
    {
      key: "loadMassKg",
      label: "Load mass",
      kind: "entered",
      mappings: transportMassDistanceMappings,
    },
  ],
  // Issue #319 removed the litres→kWh genset conversion — diesel submits by
  // volume with the EF bound on the Isometric template, so no facility
  // emission-config field is emissions-affecting anymore. The genset-yield
  // column/admin form stay (vestigial local estimate) but carry no certify
  // badge.
  facilityEmissionConfig: [],
  // The kinds below are badge/mapping documentation only — they are never fed
  // to `deriveEntityCertifyReadiness` (their gaps surface through the derived
  // transport legs and the CO2e-stored preview instead).
  delivery: [
    {
      // The delivered wet mass is the submitted value — it becomes the
      // auto-derived biochar distribution leg's load mass
      // (data-access/transport-legs.ts → syncBiocharProductTransportLeg).
      key: "deliveredWetMassKg",
      label: "Delivered wet mass",
      kind: "entered",
      mappings: [mapping("biocharTransportMassDistanceTonneKm")],
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
      // Soil temperature feeds ONLY the 200-year (Woolf 2021) durable fraction;
      // 1000-year removals derive durability from petrographic reflectance +
      // TGA non-reactive carbon and never submit it (ADR 0021). The condition
      // scopes the certify marker/readiness gap to 200-year facilities so a
      // 1000-year application is not mis-flagged for a missing soil temperature.
      // `durabilityOption` is join-derived onto the application row in
      // data-access/applications.ts.
      key: "soilTemperatureC",
      label: "Soil temperature",
      kind: "entered",
      condition: {
        field: "durabilityOption",
        equals: "200_year",
        label: "200-year durability",
      },
    },
  ],
  customerLocation: [
    {
      // Stored default distance for the auto-derived biochar distribution
      // leg (a per-delivery `distanceKmOverride` beats it when set).
      key: "distanceFromFacilityKm",
      label: "Distance from facility",
      kind: "entered",
      mappings: [mapping("biocharTransportMassDistanceTonneKm")],
    },
  ],
  supplier: [
    {
      // Supplier-level fallback distance for the auto-derived feedstock leg.
      key: "distanceToFacilityKm",
      label: "Distance to facility",
      kind: "entered",
      mappings: [mapping("feedstockTransportMassDistanceTonneKm")],
    },
  ],
  supplierLocation: [
    {
      // Default-location distance — the preferred stored level for the
      // auto-derived feedstock leg.
      key: "distanceFromFacilityKm",
      label: "Distance from facility",
      kind: "entered",
      mappings: [mapping("feedstockTransportMassDistanceTonneKm")],
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

export function isCertifyEntityField(
  entityKind: CertifyEntityKind,
  fieldName: string,
): boolean {
  return CERTIFY_FIELD_REGISTRY[entityKind].some((field) => {
    const satisfactionFields =
      field.satisfaction?.mode === "anyOf" ? field.satisfaction.fields : [];
    return (
      field.key === fieldName ||
      field.formFields?.includes(fieldName) ||
      satisfactionFields.includes(fieldName)
    );
  });
}

export function certificationDetailField(
  entityKind: CertifyEntityKind,
  fieldName: string,
): { certifyRequired: boolean } {
  return { certifyRequired: isCertifyEntityField(entityKind, fieldName) };
}
