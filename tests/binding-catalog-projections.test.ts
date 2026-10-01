/**
 * Parity for the #637 catalog projections: the certify field registry's input
 * tuples, the required transport categories, and the transport repair
 * destinations all resolve through the semantic binding catalog.
 *
 * The frozen tables are the pre-#637 literals (staging @ 677a007dc). The
 * registry tuples were declared by hand on only some fields; resolving them
 * through the catalog keeps every one and fills in the fields whose fact also
 * feeds a bound input (moisture, the Safety margin, the transport-derived
 * distances and masses).
 */
import { describe, expect, it } from "vitest";
import {
  CERTIFY_FIELD_REGISTRY,
  resolveCertifyFieldInputTuples,
} from "@/lib/certification/certify-field-registry";
import { deriveRequiredTransportCategories } from "@/fn/certification/certify-transport-coverage";
import {
  projectInputMapping,
  projectInputTuplesBySource,
  projectPeriodInputTuples,
  projectTransportCategories,
  SEMANTIC_BINDING_CATALOG,
  TRANSPORT_CATEGORIES,
  transportRepairDestination,
  type BindingInputTuple,
  type SemanticBindingCatalog,
} from "@/lib/isometric/semantic-binding-catalog";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";

const PRE_637_FIELD_SOURCES: Record<string, string[]> = {
  "productionRun.feedstockWetMassKg": ["totalFeedstockDryMassKg"],
  "productionRun.feedstockMoisturePercent": ["totalFeedstockDryMassKg"],
  "productionRun.biocharOutputKg": ["totalBiocharDryMassKg"],
  "productionRun.biocharMoisturePercent": ["totalBiocharDryMassKg"],
  "productionRun.dieselOperationLiters": ["totalStartupDieselLitres", "totalDieselLitres"],
  "productionRun.preprocessingFuelLiters": ["totalGensetDieselLitres", "totalDieselLitres"],
  "productionRun.dieselGensetLiters": ["totalGensetDieselLitres", "totalDieselLitres"],
  "productionRun.electricityKwh": ["totalElectricityKwh"],
  "sample.organicCarbonPercent": ["weightedOrganicCarbonPercent"],
  "sample.hToCOrgRatio": ["weightedHToCorgRatio"],
  "sample.oToCOrgRatio": ["weightedOToCorgRatio"],
  "feedstock.massWetKg": ["feedstockTransportMassDistanceTonneKm"],
  "feedstock.transportLeg": ["feedstockTransportMassDistanceTonneKm"],
  "transportLeg.distanceKm": [
    "feedstockTransportMassDistanceTonneKm",
    "biocharTransportMassDistanceTonneKm",
    "sampleTransportMassDistanceTonneKm",
  ],
  "transportLeg.loadMassKg": [
    "feedstockTransportMassDistanceTonneKm",
    "biocharTransportMassDistanceTonneKm",
    "sampleTransportMassDistanceTonneKm",
  ],
  "delivery.deliveredWetMassKg": ["biocharTransportMassDistanceTonneKm"],
  "customerLocation.distanceFromFacilityKm": ["biocharTransportMassDistanceTonneKm"],
  "supplier.distanceToFacilityKm": ["feedstockTransportMassDistanceTonneKm"],
  "supplierLocation.distanceFromFacilityKm": ["feedstockTransportMassDistanceTonneKm"],
};

const FEEDSTOCK_MASS_DISTANCE =
  "biomass-feedstock-transport/mass_distance_based_ci_emissions/mass_distance";
const BIOCHAR_MASS_DISTANCE = "biochar-transport/mass_distance_based_ci_emissions/mass_distance";
const SAMPLE_MASS_DISTANCE =
  "sampling-required-for-mrv/mass_distance_based_ci_emissions/mass_distance";
const PYROLYSIS_DIESEL = "pyrolysis/fuel_usage_by_volume/volume_of_fuel";
const BIOCHAR_DRY_MASS_TUPLES = [
  "biochar-transport/specific_volume_based_emissions/feedstock_mass",
  "co2-stored/carbon_rich_substance_sequestration/product_mass",
  "miscellaneous/mass_based_ci_emissions/mass",
];
const TRANSPORT_TUPLES = [BIOCHAR_MASS_DISTANCE, FEEDSTOCK_MASS_DISTANCE, SAMPLE_MASS_DISTANCE];

// The tuples the pre-#637 registry declared as literals.
const PRE_637_LITERAL_TUPLES: Record<string, string[]> = {
  "productionRun.feedstockWetMassKg": [
    "biomass-feedstock-transport/specific_volume_based_emissions/feedstock_mass",
  ],
  "productionRun.biocharOutputKg": [
    "biochar-transport/specific_volume_based_emissions/feedstock_mass",
    "co2-stored/carbon_rich_substance_sequestration/product_mass",
  ],
  "productionRun.dieselOperationLiters": [PYROLYSIS_DIESEL],
  "productionRun.preprocessingFuelLiters": [PYROLYSIS_DIESEL],
  "productionRun.dieselGensetLiters": [PYROLYSIS_DIESEL],
  "productionRun.electricityKwh": ["pyrolysis/grid_electricity_use/electricity_use"],
  "sample.organicCarbonPercent": [
    "co2-stored/carbon_rich_substance_sequestration/carbon_content",
  ],
  "transportLeg.distanceKm": TRANSPORT_TUPLES,
  "transportLeg.loadMassKg": TRANSPORT_TUPLES,
};

const RESOLVED_FIELD_TUPLES: Record<string, string[]> = {
  "productionRun.feedstockWetMassKg": [
    "biomass-feedstock-transport/specific_volume_based_emissions/feedstock_mass",
  ],
  "productionRun.feedstockMoisturePercent": [
    "biomass-feedstock-transport/specific_volume_based_emissions/feedstock_mass",
  ],
  "productionRun.biocharOutputKg": BIOCHAR_DRY_MASS_TUPLES,
  "productionRun.biocharMoisturePercent": BIOCHAR_DRY_MASS_TUPLES,
  "productionRun.dieselOperationLiters": [PYROLYSIS_DIESEL],
  "productionRun.preprocessingFuelLiters": [PYROLYSIS_DIESEL],
  "productionRun.dieselGensetLiters": [PYROLYSIS_DIESEL],
  "productionRun.electricityKwh": ["pyrolysis/grid_electricity_use/electricity_use"],
  "sample.organicCarbonPercent": [
    "co2-stored/carbon_rich_substance_sequestration/carbon_content",
  ],
  "feedstock.massWetKg": [FEEDSTOCK_MASS_DISTANCE],
  "feedstock.transportLeg": [FEEDSTOCK_MASS_DISTANCE],
  "transportLeg.distanceKm": TRANSPORT_TUPLES,
  "transportLeg.loadMassKg": TRANSPORT_TUPLES,
  "delivery.deliveredWetMassKg": [BIOCHAR_MASS_DISTANCE],
  "customerLocation.distanceFromFacilityKm": [BIOCHAR_MASS_DISTANCE],
  "supplier.distanceToFacilityKm": [FEEDSTOCK_MASS_DISTANCE],
  "supplierLocation.distanceFromFacilityKm": [FEEDSTOCK_MASS_DISTANCE],
};

// The pre-#637 TRANSPORT_SOURCE_TO_CATEGORY outcome for monitored inputs.
const PRE_637_TRANSPORT_CATEGORIES: Record<string, string> = {
  [FEEDSTOCK_MASS_DISTANCE]: "feedstock",
  [BIOCHAR_MASS_DISTANCE]: "biochar",
  [SAMPLE_MASS_DISTANCE]: "sample",
};

// The pre-#637 readiness routing (certify-readiness-gaps.ts).
const PRE_637_TRANSPORT_FIX_TARGETS = {
  feedstock: "feedstocks",
  biochar: "deliveries",
  sample: "labSamples",
};

const tupleKey = (tuple: BindingInputTuple) =>
  `${tuple.groupKey}/${tuple.blueprintKey}/${tuple.inputKey}`;

function fieldEntries() {
  return Object.entries(CERTIFY_FIELD_REGISTRY).flatMap(([kind, descriptors]) =>
    descriptors.map((descriptor) => [`${kind}.${descriptor.key}`, descriptor] as const),
  );
}

function resolvedFieldTuples(catalog?: SemanticBindingCatalog): Record<string, string[]> {
  const tuplesBySource = catalog ? projectInputTuplesBySource(catalog) : undefined;
  return Object.fromEntries(
    fieldEntries().flatMap(([field, descriptor]) => {
      const tuples = resolveCertifyFieldInputTuples(descriptor, tuplesBySource)
        .map(tupleKey)
        .sort();
      return tuples.length ? [[field, tuples]] : [];
    }),
  );
}

function everyCatalogTriple(): [string, string, string][] {
  const triples: [string, string, string][] = [];
  const tables: Record<string, Record<string, Record<string, unknown>>>[] = [
    projectInputMapping(),
    projectPeriodInputTuples(),
  ];
  for (const table of tables) {
    for (const [group, blueprints] of Object.entries(table)) {
      for (const [blueprint, inputs] of Object.entries(blueprints)) {
        for (const input of Object.keys(inputs)) triples.push([group, blueprint, input]);
      }
    }
  }
  return triples;
}

function templateOf(
  triples: [string, string, string][],
  type: "monitored" | "fixed" = "monitored",
): IsometricGhgEntryTemplate {
  return {
    groups: triples.map(([key, blueprint_key, input_key]) => ({
      key,
      components: [{ blueprint_key, inputs: [{ type, input_key }] }],
    })),
  } as unknown as IsometricGhgEntryTemplate;
}

// The same catalog with the transport `mass_distance` input renamed.
function withRenamedMassDistance(): SemanticBindingCatalog {
  const { mass_distance, ...rest } = SEMANTIC_BINDING_CATALOG.mass_distance_based_ci_emissions;
  return {
    ...SEMANTIC_BINDING_CATALOG,
    mass_distance_based_ci_emissions: { ...rest, mass_distance_v2: mass_distance },
  };
}

describe("certify field registry through the catalog", () => {
  it("keeps every field's sources", () => {
    const sources = Object.fromEntries(
      fieldEntries().flatMap(([field, descriptor]) =>
        descriptor.mappings ? [[field, descriptor.mappings.map((m) => m.source)]] : [],
      ),
    );
    expect(sources).toEqual(PRE_637_FIELD_SOURCES);
  });

  it("resolves every pre-#637 literal tuple, plus the fields whose facts also feed a bound input", () => {
    const resolved = resolvedFieldTuples();
    for (const [field, tuples] of Object.entries(PRE_637_LITERAL_TUPLES)) {
      expect(resolved[field], field).toEqual(expect.arrayContaining(tuples));
    }
    expect(resolved).toEqual(RESOLVED_FIELD_TUPLES);
  });
});

describe("transport categories through the catalog", () => {
  it("requires a category only for its monitored mass-distance input", () => {
    for (const triple of everyCatalogTriple()) {
      const key = triple.join("/");
      const expected = PRE_637_TRANSPORT_CATEGORIES[key];
      expect(deriveRequiredTransportCategories(templateOf([triple])), key).toEqual(
        expected ? [expected] : [],
      );
      expect(deriveRequiredTransportCategories(templateOf([triple], "fixed")), key).toEqual([]);
    }
    expect(deriveRequiredTransportCategories(templateOf(everyCatalogTriple()))).toEqual([
      "feedstock",
      "biochar",
      "sample",
    ]);
  });

  it("routes each category's legs to the pre-#637 fix target", () => {
    expect(
      Object.fromEntries(
        TRANSPORT_CATEGORIES.map((category) => [category, transportRepairDestination(category)]),
      ),
    ).toEqual(PRE_637_TRANSPORT_FIX_TARGETS);
  });
});

describe("one catalog edit", () => {
  it("moves the field registry tuples and the transport categories together", () => {
    const renamed = withRenamedMassDistance();
    const transportTable = projectTransportCategories(renamed);
    const legTuples = resolvedFieldTuples(renamed)["transportLeg.distanceKm"];

    expect(legTuples).toEqual([
      "biochar-transport/mass_distance_based_ci_emissions/mass_distance_v2",
      "biomass-feedstock-transport/mass_distance_based_ci_emissions/mass_distance_v2",
      "sampling-required-for-mrv/mass_distance_based_ci_emissions/mass_distance_v2",
    ]);

    const oldTemplate = templateOf(
      TRANSPORT_TUPLES.map((key) => key.split("/") as [string, string, string]),
    );
    const newTemplate = templateOf(
      TRANSPORT_TUPLES.map((key) => `${key}_v2`.split("/") as [string, string, string]),
    );
    expect(deriveRequiredTransportCategories(oldTemplate, transportTable)).toEqual([]);
    expect(deriveRequiredTransportCategories(newTemplate, transportTable)).toEqual([
      "feedstock",
      "biochar",
      "sample",
    ]);
  });
});
