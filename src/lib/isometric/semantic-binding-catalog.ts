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
 * destination once, in `SOURCE_FACTS`; bindings reference facts by key. Each
 * role also names the noma evidence roles whose Isometric Sources support it.
 * Storage components (which blueprint serves which durability tier) live in
 * the catalog's companion module, storage-blueprints.ts.
 *
 * Every other table that names a binding tuple is a projection of this
 * catalog (semantic-binding-projections.ts): `INPUT_MAPPING` and
 * `PERIOD_INPUT_TUPLES` (transformers/datapoint.ts),
 * `SEQUESTRATION_COMPONENT_INPUT_BINDINGS` (transformers/sequestration-binding.ts),
 * the input tuples behind `CERTIFY_FIELD_REGISTRY` sources, the required
 * transport categories, and the Source binding rules and persisted Source
 * target schema (certification/removal-source-bindings.ts). The one literal
 * mirror left is the diesel template walk in
 * fn/certification/submission-warnings.ts (#639); storage-blueprints.ts names
 * storage inputs beside blueprint keys without binding them.
 * tests/binding-tuple-literal-guard.test.ts fails on a new pair in any file.
 */
import type { BatchHealthFixTarget } from "@/lib/certification/batch-health";
import type { TransportCategory } from "@/lib/certification/readiness";
import type { components } from "./generated/certify";
import { IDENTITY, PERCENT_TO_FRACTION, type SourceTransform } from "./source-transforms";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "./storage-blueprints";
import {
  CARBON_CONTENTS_1000_YEAR_UNIT,
  INORGANIC_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
  PRODUCT_MASS_UNIT,
  S_FRACTION_MEASUREMENT_PROPERTY,
  S_FRACTION_UNIT,
  TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
} from "./transformers/measurement-sample";
import type {
  AggregatedProductionData,
  EmissionInputBucket,
} from "./utils/aggregation";

type DatapointType = components["schemas"]["DatapointType"];
type QuantityKindType = components["schemas"]["QuantityKindType"];
type InputDataShape = components["schemas"]["InputDataShape"];
type MeasurementProperty = components["schemas"]["MeasurementProperty"];

/**
 * Where an operator repairs a missing or wrong source fact, in the readiness
 * fix-target vocabulary. Readiness routes transport legs through
 * `transportRepairDestination`.
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

export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** Template component display names compare trimmed and lowercased. */
export function normalizeComponentDisplayName(
  componentDisplayName: string | undefined,
): string {
  return (componentDisplayName ?? "").trim().toLowerCase();
}

/** The source fact behind an aggregated source key, if the catalog knows it. */
export function lookupSourceFact(source: string): SourceFact | undefined {
  return ownValue<SourceFact>(SOURCE_FACTS, source);
}

/**
 * The one mass-distance fact each transport category submits. Transport
 * coverage, readiness routing and the certify field registry all resolve
 * transport through this map.
 */
export const TRANSPORT_SOURCE_FACTS = {
  feedstock: "feedstockTransportMassDistanceTonneKm",
  biochar: "biocharTransportMassDistanceTonneKm",
  sample: "sampleTransportMassDistanceTonneKm",
} as const satisfies Record<TransportCategory, SourceFactKey>;

export const TRANSPORT_CATEGORIES = Object.keys(
  TRANSPORT_SOURCE_FACTS,
) as readonly TransportCategory[];

/** Where an operator repairs a transport category's legs. */
export function transportRepairDestination(
  category: TransportCategory,
): RepairDestination {
  return SOURCE_FACTS[TRANSPORT_SOURCE_FACTS[category]].repairDestination;
}

/** The registry-side shape of a Datapoint value: identical in every group. */
export interface DatapointContract {
  unit: string;
  datapointType: DatapointType;
  expectedQuantityKind: QuantityKindType;
  transform?: SourceTransform;
}

/**
 * The per-source classification that maps an evidence document or generated
 * ledger to the registry inputs it supports (CONTEXT.md, "Noma evidence role").
 */
export type NomaEvidenceRole =
  | "inventory"
  | "feedstock_bill_of_lading"
  | "delivery_bill_of_lading"
  | "transport_evidence_ledger"
  | "durability_evidence_ledger"
  | "lab_report";

/**
 * A noma evidence role whose Isometric Source supports a role's input. The
 * durability evidence ledger is not declared per role: it supports every
 * input of its tier's storage components (`projectDurabilityLedgerInputKeys`).
 */
export interface EvidenceTarget {
  role: Exclude<NomaEvidenceRole, "durability_evidence_ledger">;
  /** The template may leave the input out without failing the Source plan. */
  optional?: true;
  /** Only this component, by a name the role's disambiguation rule declares. */
  component?: string;
}

/**
 * A named exception for a provider key that is not stable. Where one (group,
 * blueprint, input) triple is declared by MORE THAN ONE template component,
 * Certify exposes no stable per-component semantic key, so the component
 * display name (compared trimmed and lowercased) is the only discriminator.
 * Each named component gets its own source fact; resolveDatapointSource fails
 * closed on any other name. The data-driven replacement is tracked in
 * docs/open-questions-isometric.md (template-component-source-wizard).
 */
export interface ComponentDisambiguationRule {
  name: string;
  /** Component display name, as authored in the template, to its source fact. */
  sources: Readonly<Record<string, SourceFactKey>>;
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
  // When present, its named components REPLACE `source`.
  disambiguation?: ComponentDisambiguationRule;
  // The tuple is PROJECT-scope (ADR 0005/0018) for every component that
  // `disambiguation` does not name. The carve-out is per component, never
  // per tuple; lookupPeriodInputTuple enforces it.
  projectScopeCategory?: string;
  evidence?: readonly EvidenceTarget[];
}

/**
 * Where a measurement-sample input gets its noma value, and how sure we are
 * of the wire contract. `nomaSource` and `confirmation` are presentation only
 * and stay out of MAPPING_REVISION.
 */
export interface SequestrationSourceContract {
  nomaSource: string;
  transform: SourceTransform;
  wireUnit: string;
  confirmation: "confirmed" | "externally-unconfirmed";
}

export interface MeasurementPropertyFeed {
  dataShape: InputDataShape;
  source: "measurement-property";
  measurementProperty: MeasurementProperty;
}

export interface CreditBatchMassDirectDatapointFeed {
  dataShape: InputDataShape;
  source: "direct-datapoint";
  valueSource: "credit-batch-product-mass";
  quantityKind: QuantityKindType;
  unit: string;
  datapointType: DatapointType;
}

/**
 * A storage-component input fed by the measurement-sample step, not the
 * aggregation loop (ADR 0013): the Datapoints a measurement sample returns
 * for one measurement property, or one direct Datapoint per credit batch that
 * the removal orchestrator posts.
 */
export type MeasurementSampleRole = (MeasurementPropertyFeed | CreditBatchMassDirectDatapointFeed) & {
  strategy: "measurement-sample";
  sourceContract: SequestrationSourceContract;
  evidence?: readonly EvidenceTarget[];
};

/**
 * A tuple that belongs to a PROJECT-scope Component (ADR 0005), authored and
 * sourced entirely in the Isometric UI (ADR 0018 - noma keeps no copy). A
 * Removal Template that declares it is wrong by construction.
 */
export interface ProjectScopeForbiddenRole {
  strategy: "project-scope-forbidden";
  category: string;
}

export type BindingRole =
  | AggregatedDatapointRole
  | MeasurementSampleRole
  | ProjectScopeForbiddenRole;

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

// The Dark Earth removal template declares TWO pyrolysis `fuel_usage_by_volume`
// components: "Generator diesel usage" (generator + preprocessing, the
// "summarized" figure) and "Startup diesel usage" (reactor-startup / plant
// diesel). Names MUST match the template component display names
// (case/whitespace-insensitive).
export const PYROLYSIS_DIESEL_SPLIT: ComponentDisambiguationRule = {
  name: "pyrolysis-diesel-split",
  sources: {
    "Generator diesel usage": "totalGensetDieselLitres",
    "Startup diesel usage": "totalStartupDieselLitres",
  },
};

const SAFETY_MARGIN_COMPONENT = "Safety margin";

// Only "Safety margin" is a REMOVAL-scope, per-removal quantity among the
// miscellaneous `mass_based_ci_emissions` components. The active sandbox
// template currently has an observed fixed `carbon_intensity` Datapoint of 20
// kgCO2e/metric_ton (`dtp_1KS4PMV99SBXX88K`, verified read-only 2026-07-29);
// that value is registry-owned configuration, not a protocol requirement. noma
// submits only the exact biochar dry mass this removal claims. Any OTHER
// miscellaneous mass-based CI component is annually-sourced LCA overhead and
// stays PROJECT-scope per ADR 0005/0018.
export const SAFETY_MARGIN_CARVE_OUT: ComponentDisambiguationRule = {
  name: "safety-margin-carve-out",
  sources: { [SAFETY_MARGIN_COMPONENT]: "totalBiocharDryMassKg" },
};

// The one durability input a credit batch's mass evidence supports; every
// storage component of every tier declares it.
const INVENTORY_EVIDENCE: readonly EvidenceTarget[] = [{ role: "inventory" }];

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
          evidence: INVENTORY_EVIDENCE,
        },
      },
    },
  },

  // Sampled 1,000-year durability (ADR 0013, amended 2026-08-13; ADR 0021).
  // Confirmed for the live template; some component-blueprint catalog
  // responses omit this component, so the contract here must be exact and
  // fail closed on drift. Each list carries one value per independently
  // analysed Sample; product mass is one direct Datapoint per credit batch.
  [CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
    total_carbon_contents: {
      roles: {
        "co2-stored": {
          strategy: "measurement-sample",
          dataShape: "LIST",
          source: "measurement-property",
          measurementProperty: TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
          sourceContract: {
            nomaSource: "Sample totalCarbonPercent[]",
            transform: PERCENT_TO_FRACTION,
            wireUnit: CARBON_CONTENTS_1000_YEAR_UNIT,
            confirmation: "confirmed",
          },
          evidence: [{ role: "lab_report", optional: true }],
        },
      },
    },
    inorganic_carbon_contents: {
      roles: {
        "co2-stored": {
          strategy: "measurement-sample",
          dataShape: "LIST",
          source: "measurement-property",
          measurementProperty: INORGANIC_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
          sourceContract: {
            nomaSource: "Sample inorganicCarbonPercent[]",
            transform: PERCENT_TO_FRACTION,
            wireUnit: CARBON_CONTENTS_1000_YEAR_UNIT,
            confirmation: "externally-unconfirmed",
          },
          evidence: [{ role: "lab_report", optional: true }],
        },
      },
    },
    product_mass: {
      roles: {
        "co2-stored": {
          strategy: "measurement-sample",
          dataShape: "SCALAR",
          source: "direct-datapoint",
          valueSource: "credit-batch-product-mass",
          quantityKind: "mass",
          unit: PRODUCT_MASS_UNIT,
          datapointType: "REPORTED",
          sourceContract: {
            nomaSource: "Attribution-scaled dry applied biochar mass",
            transform: IDENTITY,
            wireUnit: PRODUCT_MASS_UNIT,
            // Standalone direct product_mass acceptance is still open in
            // docs/open-questions-isometric.md (fdurable-1000-r0-semantics);
            // keep the diagnostic honest until the registry confirms it.
            confirmation: "externally-unconfirmed",
          },
          evidence: INVENTORY_EVIDENCE,
        },
      },
    },
    s_fraction: {
      roles: {
        "co2-stored": {
          strategy: "measurement-sample",
          dataShape: "LIST",
          source: "measurement-property",
          measurementProperty: S_FRACTION_MEASUREMENT_PROPERTY,
          sourceContract: {
            nomaSource: "Sample sReflectanceFraction[]",
            transform: IDENTITY,
            wireUnit: S_FRACTION_UNIT,
            confirmation: "externally-unconfirmed",
          },
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
          evidence: [
            { role: "feedstock_bill_of_lading" },
            { role: "transport_evidence_ledger", optional: true },
          ],
        },
        // Biochar → storage transport (biochar product legs).
        "biochar-transport": {
          strategy: "aggregated-datapoint",
          source: "biocharTransportMassDistanceTonneKm",
          bucket: "delivery",
          evidence: [
            { role: "delivery_bill_of_lading" },
            { role: "transport_evidence_ledger", optional: true },
          ],
        },
        // Sample shipment to the lab, derived from the sample transport legs
        // by `enrichWithTransportLegs`. 0 when no sample legs.
        "sampling-required-for-mrv": {
          strategy: "aggregated-datapoint",
          source: "sampleTransportMassDistanceTonneKm",
          bucket: "production",
          evidence: [{ role: "transport_evidence_ledger", optional: true }],
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
        // the disambiguation rule resolves each by display name and fails
        // closed on an unrecognized one. `source` is retained only to keep the
        // combined litres in MAPPING_REVISION. Same volumetric well-to-wheel
        // EF on both (energy-use-accounting v1.3 Eq 7), so the split is
        // presentation-only. The former biomass-feedstock-sourcing/-processing
        // diesel entries were folded in here by #319; keeping them would
        // double-count.
        pyrolysis: {
          strategy: "aggregated-datapoint",
          source: "totalDieselLitres",
          disambiguation: PYROLYSIS_DIESEL_SPLIT,
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
        // The disambiguation rule is the ONLY resolver here - it doubles as
        // the named carve-out that releases the Safety margin component from
        // the PROJECT-scope guard. Every other miscellaneous component stays
        // PROJECT-scope.
        miscellaneous: {
          strategy: "aggregated-datapoint",
          source: "totalBiocharDryMassKg",
          disambiguation: SAFETY_MARGIN_CARVE_OUT,
          bucket: "stored",
          projectScopeCategory: "miscellaneous",
          // The safety-margin deduction multiplies the SAME biochar mass the
          // sequestration claim uses, so the same mass evidence justifies it.
          // Optional: the two legacy templates declare an empty
          // `miscellaneous` group.
          evidence: [{ role: "inventory", optional: true, component: SAFETY_MARGIN_COMPONENT }],
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
