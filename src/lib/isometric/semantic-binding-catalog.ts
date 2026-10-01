/**
 * Semantic binding catalog: the one code-owned place that says which noma
 * fact feeds which Certify removal-template input, and how (#291, #636).
 *
 * The catalog is keyed by the stable `(blueprint_key, input_key)` pair. Group
 * placement is not part of a binding's identity: where the group genuinely
 * changes the meaning (the same `mass_distance` input is feedstock, biochar or
 * sample transport depending on its group), the binding declares an explicit
 * role per allowed group. A group with no role has no binding.
 *
 * Each noma source fact carries its readiness provenance and repair
 * destination once, in `SOURCE_FACTS`; bindings reference facts by key.
 *
 * `INPUT_MAPPING` and `PERIOD_INPUT_TUPLES` (transformers/datapoint.ts) are
 * projections of this catalog. Sequestration (measurement-sample) bindings stay
 * in transformers/sequestration-binding.ts, and `CERTIFY_FIELD_REGISTRY` /
 * `TRANSPORT_SOURCE_TO_CATEGORY` keep their own mirrors until the next #291
 * slices move them here.
 */
import type { BatchHealthFixTarget } from "@/lib/certification/batch-health";
import type { components } from "./generated/certify";
import type {
  AggregatedProductionData,
  EmissionInputBucket,
} from "./utils/aggregation";

type DatapointType = components["schemas"]["DatapointType"];
type QuantityKindType = components["schemas"]["QuantityKindType"];

/**
 * Where an operator repairs a missing or wrong source fact: the readiness
 * fix-target vocabulary, routed as readiness already routes these facts
 * (transport legs: src/fn/certification/certify-readiness-gaps.ts).
 */
export type RepairDestination = Extract<
  BatchHealthFixTarget,
  "productionRuns" | "labSamples" | "applications" | "feedstocks" | "deliveries"
>;

export interface SourceFact {
  /** Which noma records supply the fact, as shown on readiness surfaces. */
  provenance: string;
  repairDestination: RepairDestination;
}

export const SOURCE_FACTS = {
  weightedOrganicCarbonPercent: {
    provenance: "Sample organic carbon, applied-mass weighted",
    repairDestination: "labSamples",
  },
  totalBiocharDryMassKg: {
    provenance: "Attribution-scaled dry applied biochar mass",
    repairDestination: "applications",
  },
  totalFeedstockDryMassKg: {
    provenance: "Production-run dry feedstock mass",
    repairDestination: "productionRuns",
  },
  totalStartupDieselLitres: {
    provenance: "Production-run startup diesel",
    repairDestination: "productionRuns",
  },
  totalGensetDieselLitres: {
    provenance: "Production-run generator and preprocessing diesel",
    repairDestination: "productionRuns",
  },
  totalDieselLitres: {
    provenance: "Production-run total diesel",
    repairDestination: "productionRuns",
  },
  totalElectricityKwh: {
    provenance: "Production-run electricity",
    repairDestination: "productionRuns",
  },
  feedstockTransportMassDistanceTonneKm: {
    provenance: "Feedstock transport mass-distance",
    repairDestination: "feedstocks",
  },
  biocharTransportMassDistanceTonneKm: {
    provenance: "Biochar transport mass-distance",
    repairDestination: "deliveries",
  },
  sampleTransportMassDistanceTonneKm: {
    provenance: "Sample transport mass-distance",
    repairDestination: "labSamples",
  },
} as const satisfies Partial<Record<keyof AggregatedProductionData, SourceFact>>;

export type SourceFactKey = keyof typeof SOURCE_FACTS;

/** The source fact behind an aggregated source key, if the catalog knows it. */
export function lookupSourceFact(source: string): SourceFact | undefined {
  return Object.prototype.hasOwnProperty.call(SOURCE_FACTS, source)
    ? SOURCE_FACTS[source as SourceFactKey]
    : undefined;
}

/** The registry-side shape of a Datapoint value: identical in every group. */
export interface DatapointContract {
  unit: string;
  datapointType: DatapointType;
  expectedQuantityKind: QuantityKindType;
  transform?: {
    apply: (value: number) => number;
    // Stable, declarative identity for `apply`. Function source text is not
    // stable across independently compiled Next.js bundles (a minifier may
    // rename the parameter), so MAPPING_REVISION hashes this value instead of
    // Function#toString. Bump it whenever transform semantics change.
    revision: string;
  };
}

/** An aggregated noma fact submitted as a REMOVAL-scope Datapoint. */
export interface AggregatedDatapointRole {
  strategy: "aggregated-datapoint";
  source: SourceFactKey;
  // §8.6.2 attribution basis (issue #349, ADR 0020): PRODUCTION front-loads
  // in full on the batch's claiming GHG entry; DELIVERY/STORED are
  // applied-mass-scoped. Enforcement lives in aggregation.ts (SOURCE_BUCKETS)
  // + submit-removal.ts (claim gate); the two classifications are welded by
  // tests/isometric-emission-buckets.test.ts.
  bucket: EmissionInputBucket;
  // Per-template-component source override. Set ONLY where one
  // (group, blueprint, input) triple is declared by MORE THAN ONE component.
  // Certify's template model exposes no stable per-component key, so the
  // component display name (normalized: trimmed + lowercased) is the only
  // discriminator. When present it REPLACES `source`, and
  // resolveDatapointSource fails closed on an unrecognized name. The
  // data-driven replacement (facility-configurable component→source map +
  // assignment wizard) is tracked in docs/open-questions.md.
  sourceByComponent?: Readonly<Record<string, SourceFactKey>>;
  // The tuple is PROJECT-scope (ADR 0005/0018) for every component that
  // `sourceByComponent` does not name. The carve-out is per component, never
  // per tuple; lookupPeriodInputTuple enforces it.
  projectScopeCategory?: string;
}

/**
 * A tuple that belongs to a PROJECT-scope Component (ADR 0005), authored and
 * sourced entirely in the Isometric UI (ADR 0018 - noma keeps no copy). A
 * Removal Template that declares it is wrong by construction.
 */
export interface ProjectScopeForbiddenRole {
  strategy: "project-scope-forbidden";
  category: string;
}

export type BindingRole = AggregatedDatapointRole | ProjectScopeForbiddenRole;

export interface SemanticInputBinding {
  /** Required when any role submits a Datapoint. */
  datapoint?: DatapointContract;
  /** Allowed group placements, keyed by the template group's stable key. */
  roles: Readonly<Record<string, BindingRole>>;
}

export type SemanticBindingCatalog = Readonly<
  Record<string, Readonly<Record<string, SemanticInputBinding>>>
>;

const REPORTED_KG: DatapointContract = {
  unit: "kg",
  datapointType: "REPORTED",
  expectedQuantityKind: "mass",
};

// Transport is a single `mass_distance` (tonne·km) SCALAR = Σⱼ(distⱼ × massⱼ)
// across the legs of its category (mass-weighted), with the emission factor
// held as a fixed input on the blueprint. There is no LIST-shaped transport
// blueprint in the Certify catalog, so per-leg datapoints are not possible;
// the mass-weighted sum is exact for same-factor legs. The legacy
// `distance_based_ci_emissions` sample-shipping binding was dropped: the
// re-authored template uses `mass_distance_based_ci_emissions` everywhere.
const REPORTED_TONNE_KM: DatapointContract = {
  unit: "tonne * km",
  datapointType: "REPORTED",
  expectedQuantityKind: "mass_distance",
};

// Resolves each pyrolysis `fuel_usage_by_volume` component to its diesel source
// by normalized (trimmed + lowercased) display name. The Dark Earth removal
// template declares TWO such components — "Generator diesel usage"
// (generator + preprocessing, the "summarized" figure) and "Startup diesel
// usage" (reactor-startup / plant diesel) — and Certify exposes no stable
// per-component key, so the display name is the only discriminator. Keys MUST
// match the template component display names (case/whitespace-insensitive). A
// facility-configurable mapping + assignment wizard is the planned replacement
// (docs/open-questions.md).
const PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT: Readonly<
  Record<string, SourceFactKey>
> = {
  "generator diesel usage": "totalGensetDieselLitres",
  "startup diesel usage": "totalStartupDieselLitres",
};

// Resolves the miscellaneous `mass_based_ci_emissions` component to its mass
// source by normalized display name. Only "Safety margin" is a REMOVAL-scope,
// per-removal quantity. The active sandbox template currently has an observed
// fixed `carbon_intensity` Datapoint of 20 kgCO2e/metric_ton
// (`dtp_1KS4PMV99SBXX88K`, verified read-only 2026-07-29); that value is
// registry-owned configuration, not a protocol requirement. noma submits only
// the exact biochar dry mass this removal claims. Any OTHER miscellaneous
// mass-based CI component is annually-sourced LCA overhead and stays
// PROJECT-scope per ADR 0005/0018.
const MISCELLANEOUS_MASS_SOURCE_BY_COMPONENT: Readonly<
  Record<string, SourceFactKey>
> = {
  "safety margin": "totalBiocharDryMassKg",
};

export const SEMANTIC_BINDING_CATALOG: SemanticBindingCatalog = {
  // CO₂ stored from biochar application.
  carbon_rich_substance_sequestration: {
    // Demo template declares carbon_content as dimensionless (a 0–1 fraction).
    // samples.organicCarbonPercent is 0–100, so transform converts before emit.
    carbon_content: {
      datapoint: {
        unit: "dimensionless",
        datapointType: "REPORTED",
        expectedQuantityKind: "dimensionless",
        transform: { apply: (v) => v / 100, revision: "percent-to-fraction-v1" },
      },
      roles: {
        "co2-stored": {
          strategy: "aggregated-datapoint",
          source: "weightedOrganicCarbonPercent",
          bucket: "stored",
        },
      },
    },
    product_mass: {
      datapoint: REPORTED_KG,
      roles: {
        "co2-stored": {
          strategy: "aggregated-datapoint",
          source: "totalBiocharDryMassKg",
          bucket: "stored",
        },
      },
    },
  },

  mass_distance_based_ci_emissions: {
    mass_distance: {
      datapoint: REPORTED_TONNE_KM,
      roles: {
        // Biomass → processing transport (feedstock legs).
        "biomass-feedstock-transport": {
          strategy: "aggregated-datapoint",
          source: "feedstockTransportMassDistanceTonneKm",
          bucket: "production",
        },
        // Biochar → storage transport (biochar product legs).
        "biochar-transport": {
          strategy: "aggregated-datapoint",
          source: "biocharTransportMassDistanceTonneKm",
          bucket: "delivery",
        },
        // Sample shipment to the lab, derived from the sample transport legs
        // by `enrichWithTransportLegs`. 0 when no sample legs.
        "sampling-required-for-mrv": {
          strategy: "aggregated-datapoint",
          source: "sampleTransportMassDistanceTonneKm",
          bucket: "production",
        },
      },
    },
  },

  specific_volume_based_emissions: {
    feedstock_mass: {
      datapoint: REPORTED_KG,
      roles: {
        "biomass-feedstock-transport": {
          strategy: "aggregated-datapoint",
          source: "totalFeedstockDryMassKg",
          bucket: "production",
        },
        "biochar-transport": {
          strategy: "aggregated-datapoint",
          source: "totalBiocharDryMassKg",
          bucket: "delivery",
        },
      },
    },
  },

  // Pyrolysis energy (ADR 0015, amended by #319 and again by the generator/
  // startup diesel split, docs/isometric/changes.md). Energy enters as grid
  // electricity (kWh) plus diesel volume (litres); noma never converts litres
  // to kWh nor submits the EF. Sampling consumables and lab electricity moved
  // to PROJECT scope as Project Components per ADR 0005.
  grid_electricity_use: {
    electricity_use: {
      datapoint: { unit: "kWh", datapointType: "REPORTED", expectedQuantityKind: "energy" },
      roles: {
        pyrolysis: {
          strategy: "aggregated-datapoint",
          source: "totalElectricityKwh",
          bucket: "production",
        },
        "sampling-required-for-mrv": {
          strategy: "project-scope-forbidden",
          category: "lab_electricity",
        },
      },
    },
  },

  fuel_usage_by_volume: {
    volume_of_fuel: {
      datapoint: { unit: "l", datapointType: "REPORTED", expectedQuantityKind: "volume" },
      roles: {
        // TWO components share this triple (generator vs. startup diesel);
        // sourceByComponent resolves each by display name and fails closed on
        // an unrecognized one. `source` is retained only to keep the combined
        // litres in MAPPING_REVISION. Same volumetric well-to-wheel EF on both
        // (energy-use-accounting v1.3 Eq 7), so the split is presentation-only.
        // The former biomass-feedstock-sourcing/-processing diesel entries were
        // folded in here by #319; keeping them would double-count.
        pyrolysis: {
          strategy: "aggregated-datapoint",
          source: "totalDieselLitres",
          sourceByComponent: PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT,
          bucket: "production",
        },
        "biochar-storage": {
          strategy: "project-scope-forbidden",
          category: "biochar_storage_fuel",
        },
      },
    },
  },

  mass_based_ci_emissions: {
    mass: {
      datapoint: REPORTED_KG,
      roles: {
        // sourceByComponent is the ONLY resolver here - it doubles as the
        // named carve-out that releases the Safety margin component from the
        // PROJECT-scope guard. Every other miscellaneous component stays
        // PROJECT-scope.
        miscellaneous: {
          strategy: "aggregated-datapoint",
          source: "totalBiocharDryMassKg",
          sourceByComponent: MISCELLANEOUS_MASS_SOURCE_BY_COMPONENT,
          bucket: "stored",
          projectScopeCategory: "miscellaneous",
        },
        "sampling-required-for-mrv": {
          strategy: "project-scope-forbidden",
          category: "sampling_consumables",
        },
      },
    },
  },

  distance_based_ci_emissions: {
    distance: {
      roles: {
        "staff-travel": { strategy: "project-scope-forbidden", category: "staff_travel" },
      },
    },
  },

  ghg_direct_emissions: {
    concentration: {
      roles: {
        "direct-emissions": {
          strategy: "project-scope-forbidden",
          category: "pyrolyzer_direct",
        },
      },
    },
    mass_flow: {
      roles: {
        "direct-emissions": {
          strategy: "project-scope-forbidden",
          category: "pyrolyzer_direct",
        },
      },
    },
  },
};

/* -------------------------------------------------------------------------------------------------
 * Projections: the (group, blueprint, input) tables the transformers resolve against.
 * -----------------------------------------------------------------------------------------------*/

export interface InputMappingEntry {
  source: keyof AggregatedProductionData;
  unit: string;
  datapointType: DatapointType;
  expectedQuantityKind: QuantityKindType;
  bucket: EmissionInputBucket;
  transform?: (value: number) => number;
  transformRevision?: string;
  sourceByComponent?: Readonly<Record<string, keyof AggregatedProductionData>>;
}

// (group_key, blueprint_key, input_key) → entry. Group keys are stable
// kebab-case slugs from the template's RemovalTemplateComponentGroup.key.
export type InputMappingTable = Record<
  string,
  Record<string, Record<string, InputMappingEntry>>
>;

export type PeriodInputTupleTable = Record<
  string,
  Record<string, Record<string, { category: string }>>
>;

function setTriple<T>(
  table: Record<string, Record<string, Record<string, T>>>,
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
  value: T,
): void {
  const blueprints = (table[groupKey] ??= {});
  const inputs = (blueprints[blueprintKey] ??= {});
  inputs[inputKey] = value;
}

/** Every aggregated-datapoint role as an INPUT_MAPPING entry. */
export function projectInputMapping(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): InputMappingTable {
  const table: InputMappingTable = {};
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      for (const [groupKey, role] of Object.entries(binding.roles)) {
        if (role.strategy !== "aggregated-datapoint") continue;
        const { datapoint } = binding;
        if (!datapoint) {
          throw new Error(
            `Semantic binding ${blueprintKey}/${inputKey} has a datapoint role in "${groupKey}" without a datapoint contract`,
          );
        }
        const entry: InputMappingEntry = {
          source: role.source,
          unit: datapoint.unit,
          datapointType: datapoint.datapointType,
          expectedQuantityKind: datapoint.expectedQuantityKind,
          bucket: role.bucket,
        };
        if (datapoint.transform) {
          entry.transform = datapoint.transform.apply;
          entry.transformRevision = datapoint.transform.revision;
        }
        if (role.sourceByComponent) entry.sourceByComponent = role.sourceByComponent;
        setTriple(table, groupKey, blueprintKey, inputKey, entry);
      }
    }
  }
  return table;
}

/**
 * Every PROJECT-scope tuple: forbidden roles, plus aggregated roles whose
 * unnamed components stay PROJECT-scope.
 */
export function projectPeriodInputTuples(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): PeriodInputTupleTable {
  const table: PeriodInputTupleTable = {};
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      for (const [groupKey, role] of Object.entries(binding.roles)) {
        if (
          role.strategy === "aggregated-datapoint" &&
          role.projectScopeCategory &&
          !role.sourceByComponent
        ) {
          throw new Error(
            `Semantic binding ${blueprintKey}/${inputKey} in "${groupKey}" is project-scope with no named component carve-out`,
          );
        }
        const category =
          role.strategy === "project-scope-forbidden"
            ? role.category
            : role.projectScopeCategory;
        if (category) setTriple(table, groupKey, blueprintKey, inputKey, { category });
      }
    }
  }
  return table;
}
