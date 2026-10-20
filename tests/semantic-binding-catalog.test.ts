beforeEach(() => { vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", "false"); });
afterEach(() => { vi.unstubAllEnvs(); });
import type { LineContract } from "@/lib/isometric/template-observations/line-sources";
/**
 * Parity for the semantic binding catalog (#636): the catalog's projections
 * must resolve every (group, blueprint, input) tuple exactly as the literal
 * INPUT_MAPPING and PERIOD_INPUT_TUPLES did before the catalog existed, and
 * MAPPING_REVISION is pinned to the entry-contribution policy (PR 4).
 *
 * The frozen tables below are the pre-catalog literals (staging @ 41ac738fe),
 * with transform functions reduced to their transformRevision. Change them
 * only together with an intentional binding change.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import {
  lookupSourceFact,
  SEMANTIC_BINDING_CATALOG,
  type SemanticBindingCatalog,
} from "@/lib/isometric/semantic-binding-catalog";
import {
  projectInputMapping,
  projectPeriodInputTuples,
} from "@/lib/isometric/semantic-binding-projections";
import {
  INPUT_MAPPING,
  lookupInputMapping,
  lookupPeriodInputTuple,
  MAPPING_REVISION,
  resolveDatapointSource,
} from "@/lib/isometric/transformers/datapoint";

const ENTRY_CONTRIBUTION_MAPPING_REVISION =
  "72a68a1d8d2b61b338c874fe101275dfb2185b1a53851de4339ff5588d412315";

const PRE_CATALOG_INPUT_MAPPING = {
  "co2-stored": {
    "carbon_rich_substance_sequestration": {
      "carbon_content": {
        "source": "weightedOrganicCarbonPercent",
        "unit": "dimensionless",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "dimensionless",
        "bucket": "stored",
        "transformRevision": "percent-to-fraction-v1"
      },
      "product_mass": {
        "source": "totalBiocharDryMassKg",
        "unit": "kg",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "mass",
        "bucket": "stored"
      }
    }
  },
  "biomass-feedstock-transport": {
    "mass_distance_based_ci_emissions": {
      "mass_distance": {
        "source": "feedstockTransportMassDistanceTonneKm",
        "unit": "tonne * km",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "mass_distance",
        "bucket": "production"
      }
    },
    "specific_volume_based_emissions": {
      "feedstock_mass": {
        "source": "totalFeedstockDryMassKg",
        "unit": "kg",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "mass",
        "bucket": "production"
      }
    }
  },
  "biochar-transport": {
    "mass_distance_based_ci_emissions": {
      "mass_distance": {
        "source": "biocharTransportMassDistanceTonneKm",
        "unit": "tonne * km",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "mass_distance",
        "bucket": "delivery"
      }
    },
    "specific_volume_based_emissions": {
      "feedstock_mass": {
        "source": "totalBiocharDryMassKg",
        "unit": "kg",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "mass",
        "bucket": "delivery"
      }
    }
  },
  "sampling-required-for-mrv": {
    "mass_distance_based_ci_emissions": {
      "mass_distance": {
        "source": "sampleTransportMassDistanceTonneKm",
        "unit": "tonne * km",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "mass_distance",
        "bucket": "production"
      }
    }
  },
  "pyrolysis": {
    "grid_electricity_use": {
      "electricity_use": {
        "source": "totalElectricityKwh",
        "unit": "kWh",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "energy",
        "bucket": "production"
      }
    },
    "fuel_usage_by_volume": {
      "volume_of_fuel": {
        "source": "totalDieselLitres",
        "sourceByComponent": {
          "generator diesel usage": "totalGensetDieselLitres",
          "startup diesel usage": "totalStartupDieselLitres"
        },
        "unit": "l",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "volume",
        "bucket": "production"
      }
    }
  },
  "miscellaneous": {
    "mass_based_ci_emissions": {
      "mass": {
        "source": "totalBiocharDryMassKg",
        "sourceByComponent": {
          "safety margin": "totalBiocharDryMassKg"
        },
        "unit": "kg",
        "datapointType": "REPORTED",
        "expectedQuantityKind": "mass",
        "bucket": "stored"
      }
    }
  }
} as const;

const PRE_CATALOG_PERIOD_INPUT_TUPLES: Record<string, { category: string }> = {
  "staff-travel/distance_based_ci_emissions/distance": {
    "category": "staff_travel"
  },
  "direct-emissions/ghg_direct_emissions/concentration": {
    "category": "pyrolyzer_direct"
  },
  "direct-emissions/ghg_direct_emissions/mass_flow": {
    "category": "pyrolyzer_direct"
  },
  "biochar-storage/fuel_usage_by_volume/volume_of_fuel": {
    "category": "biochar_storage_fuel"
  },
  "miscellaneous/mass_based_ci_emissions/mass": {
    "category": "miscellaneous"
  },
  "sampling-required-for-mrv/mass_based_ci_emissions/mass": {
    "category": "sampling_consumables"
  },
  "sampling-required-for-mrv/grid_electricity_use/electricity_use": {
    "category": "lab_electricity"
  }
};

type FrozenTable = Record<string, Record<string, Record<string, Record<string, unknown>>>>;

function triples(
  table: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>,
): [string, string, string][] {
  return Object.entries(table).flatMap(([group, blueprints]) =>
    Object.entries(blueprints).flatMap(([blueprint, inputs]) =>
      Object.keys(inputs).map((input): [string, string, string] => [group, blueprint, input]),
    ),
  );
}

describe("semantic binding catalog parity", () => {
  it("pins MAPPING_REVISION for entry contributions", () => {
    expect(MAPPING_REVISION).toBe(ENTRY_CONTRIBUTION_MAPPING_REVISION);
  });

  it("projects INPUT_MAPPING to the pre-catalog literal", () => {
    // JSON drops the transform functions; their identity is transformRevision.
    expect(JSON.parse(JSON.stringify(INPUT_MAPPING))).toEqual(PRE_CATALOG_INPUT_MAPPING);
  });

  it("resolves every pre-catalog tuple identically", () => {
    for (const [group, blueprint, input] of triples(PRE_CATALOG_INPUT_MAPPING)) {
      const entry = lookupInputMapping(group, blueprint, input);
      const frozen = PRE_CATALOG_INPUT_MAPPING[
        group as keyof typeof PRE_CATALOG_INPUT_MAPPING
      ] as FrozenTable[string];
      expect(entry, `${group}/${blueprint}/${input}`).toMatchObject(frozen[blueprint][input]);
    }
  });

  it("keeps the only transform: percent to fraction", () => {
    const transforms = triples(PRE_CATALOG_INPUT_MAPPING).flatMap(([group, blueprint, input]) => {
      const entry = lookupInputMapping(group, blueprint, input);
      return entry?.transform ? [[`${group}/${blueprint}/${input}`, entry.transform(50)]] : [];
    });
    expect(transforms).toEqual([["co2-stored/carbon_rich_substance_sequestration/carbon_content", 0.5]]);
  });

  it("resolves per-component sources and fails closed on unknown names", () => {
    const diesel = lookupInputMapping("pyrolysis", "fuel_usage_by_volume", "volume_of_fuel")!;
    expect(resolveDatapointSource(diesel, { scope: "operating", entryPolicy: "none", origin: "reviewed", automaticSource: "run-genset-diesel" } satisfies LineContract)).toBe("totalGensetDieselLitres");
    expect(resolveDatapointSource(diesel, { scope: "operating", entryPolicy: "none", origin: "reviewed", automaticSource: "run-startup-diesel" } satisfies LineContract)).toBe("totalStartupDieselLitres");
    expect(() => resolveDatapointSource(diesel, { scope: "operating", entryPolicy: "none", origin: "reviewed" } satisfies LineContract)).toThrow();
    const margin = lookupInputMapping("miscellaneous", "mass_based_ci_emissions", "mass")!;
    expect(resolveDatapointSource(margin, { scope: "operating", entryPolicy: "none", origin: "reviewed", automaticSource: "safety-margin" } satisfies LineContract)).toBe("totalBiocharDryMassKg");
  });

  it("projects PERIOD_INPUT_TUPLES to the pre-catalog literal", () => {
    const projected = projectPeriodInputTuples();
    const flattened = Object.fromEntries(
      triples(projected).map(([group, blueprint, input]) => [
        `${group}/${blueprint}/${input}`,
        projected[group][blueprint][input],
      ]),
    );
    expect(flattened).toEqual(PRE_CATALOG_PERIOD_INPUT_TUPLES);
    for (const key of Object.keys(PRE_CATALOG_PERIOD_INPUT_TUPLES)) {
      const [group, blueprint, input] = key.split("/");
      expect(lookupPeriodInputTuple(group, blueprint, input), key).toEqual(
        PRE_CATALOG_PERIOD_INPUT_TUPLES[key],
      );
    }
    // The carve-out is per component: only the named Safety margin is released.
    expect(
      lookupPeriodInputTuple("miscellaneous", "mass_based_ci_emissions", "mass", { scope: "operating", entryPolicy: "none", origin: "reviewed", automaticSource: "safety-margin" } satisfies LineContract),
    ).toBeUndefined();
    expect(
      lookupPeriodInputTuple("miscellaneous", "mass_based_ci_emissions", "mass", { scope: "operating", entryPolicy: "none", origin: "reviewed" } satisfies LineContract),
    ).toEqual({ category: "miscellaneous" });
  });

  it("gives every bound source fact a provenance and a repair destination", () => {
    for (const [group, blueprint, input] of triples(INPUT_MAPPING)) {
      const entry = INPUT_MAPPING[group][blueprint][input];
      for (const source of [entry.source, ...Object.values(entry.sourceByComponent ?? {})]) {
        const fact = lookupSourceFact(source);
        expect(fact?.provenance, source).toBeTruthy();
        expect(fact?.repairDestination, source).toBeTruthy();
      }
    }
  });

  it("rejects a datapoint role without a datapoint contract", () => {
    const broken: SemanticBindingCatalog = {
      ...SEMANTIC_BINDING_CATALOG,
      some_blueprint: {
        some_input: {
          roles: {
            pyrolysis: { strategy: "aggregated-datapoint", source: "totalElectricityKwh", bucket: "production" },
          },
        },
      },
    };
    expect(() => projectInputMapping(broken)).toThrow(/without a datapoint contract/);
  });

  it("rejects a project-scope datapoint role with no named carve-out", () => {
    const broken: SemanticBindingCatalog = {
      ...SEMANTIC_BINDING_CATALOG,
      some_blueprint: {
        some_input: {
          datapoint: { unit: "kg", datapointType: "REPORTED", expectedQuantityKind: "mass" },
          roles: {
            miscellaneous: {
              strategy: "aggregated-datapoint",
              source: "totalBiocharDryMassKg",
              bucket: "stored",
              projectScopeCategory: "miscellaneous",
            },
          },
        },
      },
    };
    expect(() => projectPeriodInputTuples(broken)).toThrow(/no named component carve-out/);
  });
});

it.each([false, true])("keeps the mapping revision stable while retiring sample runtime lookups (gate: %s)", async (enabled) => {
  vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", enabled ? "true" : "false");
  const { buildMappingRevisionInput } = await import("@/lib/isometric/transformers/datapoint");
  const { payloadHash } = await import("@/lib/isometric/utils/payload-hash");
  expect(payloadHash(buildMappingRevisionInput())).toBe(PRE_CATALOG_MAPPING_REVISION);
  expect(MAPPING_REVISION).toBe(PRE_CATALOG_MAPPING_REVISION);
  expect(INPUT_MAPPING["sampling-required-for-mrv"].mass_distance_based_ci_emissions.mass_distance.source).toBe("sampleTransportMassDistanceTonneKm");
  expect(lookupInputMapping("sampling-required-for-mrv", "mass_distance_based_ci_emissions", "mass_distance") === undefined).toBe(enabled);
  expect(lookupSourceFact("sampleTransportMassDistanceTonneKm") === undefined).toBe(enabled);
});

it("keeps fresh module-load projections identical across activation states", async () => {
  vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", "true");
  vi.resetModules();
  const activated = await import("@/lib/isometric/transformers/datapoint");
  expect(activated.MAPPING_REVISION).toBe(PRE_CATALOG_MAPPING_REVISION);
  expect(JSON.parse(JSON.stringify(activated.INPUT_MAPPING))).toEqual(PRE_CATALOG_INPUT_MAPPING);
  vi.stubEnv("EMISSIONS_ENTRIES_ENABLED", "false");
  vi.resetModules();
  expect((await import("@/lib/isometric/transformers/datapoint")).MAPPING_REVISION).toBe(activated.MAPPING_REVISION);
});
