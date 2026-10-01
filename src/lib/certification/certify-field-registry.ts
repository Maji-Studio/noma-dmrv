import {
  TRANSPORT_CATEGORIES,
  TRANSPORT_SOURCE_FACTS,
} from "@/lib/isometric/semantic-binding-catalog";
import {
  projectInputTuplesBySource,
  type BindingInputTuple,
  type InputTuplesBySource,
} from "@/lib/isometric/semantic-binding-projections";
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

// A field names only the aggregated facts it feeds. Which removal-template
// inputs those facts reach is owned by the semantic binding catalog and
// resolved by `resolveCertifyFieldInputTuples`.
export interface CertifySourceMapping {
  source: AggregatedProductionSource;
}

export type CertifyFieldCondition =
  | {
      field: string;
      equals: string | number | boolean | null;
      label: string;
    }
  | {
      allOf: readonly {
        field: string;
        equals: string | number | boolean | null;
      }[];
      label: string;
    };

export type CertifyFieldSatisfaction =
  | { mode: "field" }
  | { mode: "allOf"; fields: readonly string[]; label: string }
  | { mode: "anyOf"; fields: readonly string[]; label: string }
  | {
      mode: "equals";
      field: string;
      value: string | number | boolean | null;
      label: string;
    };

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

const mapping = (source: AggregatedProductionSource): CertifySourceMapping => ({
  source,
});

// Pyrolysis energy: one grid-electricity datapoint plus diesel volume via
// `fuel_usage_by_volume` (ADR 0015, amended by #319 then the generator/startup
// diesel split — docs/isometric/changes.md). The Dark Earth template declares
// two `fuel_usage_by_volume` components (generator + preprocessing vs. startup)
// sharing one fixed volumetric EF; the catalog resolves each to its own
// source. `dieselFuelVolumeMapping` names the combined litres for badge
// traceability — the per-field source (startup vs. genset litres) is set on
// each descriptor.
const electricityMapping = mapping("totalElectricityKwh");

const dieselFuelVolumeMapping = mapping("totalDieselLitres");

// Each transport category submits a single `mass_distance` (tonne·km) datapoint
// = Σⱼ(distⱼ × massⱼ). Both a leg's distance AND its load mass feed that figure,
// so the transportLeg.distanceKm and .loadMassKg fields share these mappings.
const transportMassDistanceMappings = TRANSPORT_CATEGORIES.map((category) =>
  mapping(TRANSPORT_SOURCE_FACTS[category]),
);

export const CERTIFY_FIELD_REGISTRY: Record<
  CertifyEntityKind,
  readonly CertifyFieldDescriptor[]
> = {
  productionRun: [
    {
      key: "hasReadingsFile",
      label: "Readings CSV file",
      kind: "derived",
      formFields: ["readingsCsv"],
      satisfaction: {
        mode: "equals",
        field: "hasReadingsFile",
        value: true,
        label: "Readings CSV file supplied",
      },
    },
    {
      key: "feedstockWetMassKg",
      label: "Feedstock wet mass",
      kind: "entered",
      mappings: [mapping("totalFeedstockDryMassKg")],
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
      mappings: [mapping("totalBiocharDryMassKg")],
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
      key: "totalCarbonPercent",
      label: "Total carbon",
      kind: "entered",
      condition: {
        allOf: [
          { field: "durabilityOption", equals: "1000_year" },
          { field: "sampling", equals: "sampled" },
        ],
        label: "sampled 1,000-year durability",
      },
    },
    {
      key: "inorganicCarbonPercent",
      label: "Measured inorganic carbon",
      kind: "entered",
      condition: {
        allOf: [
          { field: "durabilityOption", equals: "1000_year" },
          { field: "sampling", equals: "sampled" },
        ],
        label: "sampled 1,000-year durability",
      },
    },
    {
      key: "organicCarbonPercent",
      label: "Organic carbon",
      kind: "entered",
      mappings: [mapping("weightedOrganicCarbonPercent")],
    },
    {
      key: "hToCOrgRatio",
      label: "H:Corg ratio",
      kind: "entered",
      formFields: [
        "totalHydrogenPercent",
        "organicCarbonPercent",
        "hToCOrgRatio",
      ],
      satisfaction: {
        mode: "anyOf",
        fields: ["hToCOrgRatio"],
        label: "H:Corg ratio",
      },
      mappings: [mapping("weightedHToCorgRatio")],
    },
    {
      // Unconditional, like H:Corg: the Soil Module §3.3 Table 2 eligibility
      // check is universal (pooled mean H/C_org < 0.5 AND O/C_org < 0.2), not
      // tier-specific. Without this descriptor a sample missing oxygen badged
      // "chemistry complete" while the usable-replicate gate
      // (biochar-eligibility.ts, durability-submission-gates.ts) refused to
      // count it toward the §8.3.1 ≥3 minimum (QA 2026-07-25 F-6).
      key: "oToCOrgRatio",
      label: "O:Corg ratio",
      kind: "entered",
      mappings: [mapping("weightedOToCorgRatio")],
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
      // (data-access/transport-legs.ts → syncFeedstockTransportLeg).
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
      satisfaction: {
        mode: "anyOf",
        fields: ["transportDistanceKm"],
        label: "Transport distance",
      },
      mappings: [mapping("feedstockTransportMassDistanceTonneKm")],
    },
    {
      key: "transportDistanceProvenance",
      label: "Transport distance provenance",
      kind: "derived",
      satisfaction: {
        mode: "anyOf",
        fields: ["transportDistanceSource"],
        label: "Transport distance provenance",
      },
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
  // The kinds below stay out of the Removal submission's entity-readiness
  // walk (which covers production runs, samples, and transport legs); their
  // descriptors drive form/detail badges and the list readiness pills.
  delivery: [
    {
      // The biochar product wet mass is the submitted value. It becomes the
      // auto-derived biochar distribution leg's load mass
      // (data-access/transport-legs.ts → syncLockedBiocharProductTransportLeg).
      key: "deliveredWetMassKg",
      label: "Biochar product wet mass",
      kind: "entered",
      mappings: [mapping("biocharTransportMassDistanceTonneKm")],
    },
  ],
  application: [
    // Carbon inputs for the CO2e-stored calculation
    // (lib/calculations/biochar-removal.ts → computeApplicationCo2eStored):
    // dry biochar is allocated proportionally from the selected delivery's
    // tracked dry biochar. Delivery moisture is independent evidence.
    {
      key: "biocharAppliedTons",
      label: "Biochar product applied",
      kind: "entered",
    },
    {
      key: "biocharAppliedDryTons",
      label: "Dry biochar applied",
      kind: "derived",
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

const INPUT_TUPLES_BY_SOURCE: InputTuplesBySource = projectInputTuplesBySource();

/**
 * The removal-template inputs a certify field feeds, resolved through the
 * semantic binding catalog from the facts its mappings name.
 */
export function resolveCertifyFieldInputTuples(
  descriptor: CertifyFieldDescriptor,
  tuplesBySource: InputTuplesBySource = INPUT_TUPLES_BY_SOURCE,
): BindingInputTuple[] {
  const seen = new Set<string>();
  const tuples: BindingInputTuple[] = [];
  for (const { source } of descriptor.mappings ?? []) {
    for (const tuple of tuplesBySource[source as keyof InputTuplesBySource] ?? []) {
      const key = `${tuple.groupKey}/${tuple.blueprintKey}/${tuple.inputKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tuples.push(tuple);
    }
  }
  return tuples;
}

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
      field.satisfaction?.mode === "anyOf" ||
      field.satisfaction?.mode === "allOf"
        ? field.satisfaction.fields
        : field.satisfaction?.mode === "equals"
          ? [field.satisfaction.field]
          : [];
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
