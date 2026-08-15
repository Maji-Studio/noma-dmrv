import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import type {
  AggregatedProductionData,
  EmissionInputBucket,
} from "../utils/aggregation";
import { payloadHash } from "../utils/payload-hash";
import {
  RegistryMappingError,
  SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
} from "./sequestration-binding";

type DatapointType = components["schemas"]["DatapointType"];
type QuantityKindType = components["schemas"]["QuantityKindType"];
type ComponentBlueprintInput = components["schemas"]["ComponentBlueprintInput"];
type GhgEntryTemplateComponentInput =
  components["schemas"]["GhgEntryTemplateComponentInput"];

export interface InputMappingEntry {
  source: keyof AggregatedProductionData;
  unit: string;
  datapointType: DatapointType;
  expectedQuantityKind: QuantityKindType;
  // §8.6.2 attribution basis (issue #349, ADR 0020): PRODUCTION front-loads
  // in full on the batch's claiming GHG entry; DELIVERY/STORED are
  // applied-mass-scoped. Enforcement lives in aggregation.ts (SOURCE_BUCKETS)
  // + submit-removal.ts (claim gate); the two classifications are welded by
  // tests/isometric-emission-buckets.test.ts.
  bucket: EmissionInputBucket;
  transform?: (value: number) => number;
  // Stable, declarative identity for `transform`. Function source text is not
  // stable across independently compiled Next.js bundles (a minifier may, for
  // example, rename the parameter), so MAPPING_REVISION hashes this value
  // instead of Function#toString. Bump it whenever transform semantics change.
  transformRevision?: string;
  // Per-template-component source override. Set ONLY where one
  // (group, blueprint, input) triple is declared by MORE THAN ONE component
  // (e.g. the pyrolysis diesel split: "Generator diesel usage" vs "Startup
  // diesel usage"). Certify's template model exposes no stable per-component
  // key, so the component display name (normalized: trimmed + lowercased) is
  // the only discriminator. When present it REPLACES `source`, and
  // buildCreateDatapointRequest fails closed on an unrecognized name — a rename
  // or added component surfaces loudly instead of silently double-counting or
  // mis-bucketing. The data-driven replacement (facility-configurable
  // component→source map + assignment wizard) is tracked in
  // docs/open-questions.md.
  sourceByComponent?: Readonly<Record<string, keyof AggregatedProductionData>>;
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

function ownValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

export function normalizeComponentDisplayName(
  componentDisplayName: string | undefined,
): string {
  return (componentDisplayName ?? "").trim().toLowerCase();
}

function lookupThreeLevelValue<T>(
  table: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, T>>>>>
  >,
  firstKey: string,
  secondKey: string,
  thirdKey: string,
): T | undefined {
  const secondLevel = ownValue(table, firstKey);
  if (!secondLevel) return undefined;
  const thirdLevel = ownValue(secondLevel, secondKey);
  return thirdLevel ? ownValue(thirdLevel, thirdKey) : undefined;
}

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
  Record<string, keyof AggregatedProductionData>
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
// PROJECT-scope per ADR 0005/0018 - the PERIOD_INPUT_TUPLES guard still fires
// for it (see lookupPeriodInputTuple).
const MISCELLANEOUS_MASS_SOURCE_BY_COMPONENT: Readonly<
  Record<string, keyof AggregatedProductionData>
> = {
  "safety margin": "totalBiocharDryMassKg",
};

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
        bucket: "stored",
        transform: (v) => v / 100,
        transformRevision: "percent-to-fraction-v1",
      },
      product_mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
        bucket: "stored",
      },
    },
  },

  // Biomass → processing transport (feedstock leg category). The template
  // binds this to `mass_distance_based_ci_emissions`: a single `mass_distance`
  // (tonne·km) SCALAR = Σⱼ(distⱼ × massⱼ) across the run's feedstock legs
  // (multiple deliveries / storage bins, mass-weighted), with the emission
  // factor held as a fixed input on the blueprint. There is no LIST-shaped
  // transport blueprint in the Certify catalog, so per-leg datapoints are not
  // possible — the mass-weighted sum is exact for same-factor legs.
  "biomass-feedstock-transport": {
    mass_distance_based_ci_emissions: {
      mass_distance: {
        source: "feedstockTransportMassDistanceTonneKm",
        unit: "tonne * km",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass_distance",
        bucket: "production",
      },
    },
    specific_volume_based_emissions: {
      feedstock_mass: {
        source: "totalFeedstockDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
        bucket: "production",
      },
    },
  },

  // Biochar → storage transport (biochar product leg category). Same
  // mass_distance (tonne·km) model as feedstock transport above.
  "biochar-transport": {
    mass_distance_based_ci_emissions: {
      mass_distance: {
        source: "biocharTransportMassDistanceTonneKm",
        unit: "tonne * km",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass_distance",
        bucket: "delivery",
      },
    },
    specific_volume_based_emissions: {
      feedstock_mass: {
        source: "totalBiocharDryMassKg",
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
        bucket: "delivery",
      },
    },
  },

  // Sample shipping to lab — mass_distance (tonne·km), like the feedstock and
  // biochar transport categories. (The legacy `distance_based_ci_emissions`
  // binding was dropped: the re-authored template uses
  // `mass_distance_based_ci_emissions` for every transport category.)
  "sampling-required-for-mrv": {
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
        bucket: "production",
      },
    },
  },

  // Pyrolysis energy (ADR 0015, amended by #319 and again by the generator/
  // startup diesel split — docs/isometric/changes.md). Energy enters as grid
  // electricity (`grid_electricity_use`, kWh) plus diesel volume
  // (`fuel_usage_by_volume`, litres). The Dark Earth template declares TWO
  // diesel components — "Generator diesel usage" (generator + preprocessing)
  // and "Startup diesel usage" (reactor-startup / plant) — so the single
  // `volume_of_fuel` triple resolves per component via
  // PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT. Both share one volumetric well-to-
  // wheel EF pre-bound on the template (energy-use-accounting v1.3 Eq 7), so
  // the split is presentation-only; noma never converts litres to kWh nor
  // submits the EF. The former `energy_based_ci_emissions` genset entry modeled
  // fuel as electricity CI and is gone (protocol-noncompliant; issue #319).
  pyrolysis: {
    grid_electricity_use: {
      electricity_use: {
        source: "totalElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
        bucket: "production",
      },
    },
    fuel_usage_by_volume: {
      volume_of_fuel: {
        // TWO components share this triple (generator vs. startup diesel);
        // sourceByComponent resolves each by display name. Because
        // sourceByComponent is set, resolveDatapointSource FAILS CLOSED on an
        // unrecognized component name — it never falls back to `source` at
        // runtime (a collapsed/renamed template surfaces loudly, see
        // resolveDatapointSource). `source` is retained only to satisfy the
        // non-optional type and to keep the combined litres in MAPPING_REVISION.
        // Same volumetric EF on both, so the split is presentation-only
        // (docs/isometric/changes.md, amends #319).
        source: "totalDieselLitres",
        sourceByComponent: PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT,
        unit: "l",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
        bucket: "production",
      },
    },
  },

  miscellaneous: {
    mass_based_ci_emissions: {
      mass: {
        // sourceByComponent is the ONLY resolver here - it doubles as the
        // named carve-out key that releases this tuple from the PROJECT-scope
        // guard. An unrecognized miscellaneous component never reaches this
        // entry (the guard fires first) and would fail closed in
        // resolveDatapointSource even if it did.
        source: "totalBiocharDryMassKg",
        sourceByComponent: MISCELLANEOUS_MASS_SOURCE_BY_COMPONENT,
        unit: "kg",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass",
        bucket: "stored",
      },
    },
  },

  // Four blueprint families that live only as PROJECT-scope inputs
  // (`staff-travel/distance_based_ci_emissions`,
  // `direct-emissions/ghg_direct_emissions` × 2 inputs,
  // `biochar-storage/fuel_usage_by_volume`) and two more under
  // `sampling-required-for-mrv` moved to PROJECT scope as Project
  // Components per ADR 0005. The miscellaneous family remains PROJECT-scope
  // except for the explicitly named Safety margin component above. All tuples
  // remain in PERIOD_INPUT_TUPLES below; a Removal Template that declares one
  // without a named carve-out trips the scope-conflict SafeError in
  // buildCreateDatapointRequest.

  // (The former `biomass-feedstock-sourcing` / `biomass-feedstock-processing`
  // `fuel_usage_by_volume` entries carried startup/plant diesel separately.
  // Issue #319 folded that diesel into the combined `pyrolysis /
  // fuel_usage_by_volume` datapoint above — keeping them would double-count.
  // The previous `miscellaneous` zero-stub remains guarded for every component
  // except the named Safety margin carve-out.)
};

export function lookupInputMapping(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): InputMappingEntry | undefined {
  return lookupThreeLevelValue(
    INPUT_MAPPING,
    groupKey,
    blueprintKey,
    inputKey,
  );
}

// Resolves the aggregated-source field for a mapping. Usually just
// `mapping.source`; when the mapping carries a per-component override (a triple
// declared by >1 template component — e.g. the pyrolysis diesel split), it
// resolves by normalized component display name and FAILS CLOSED on an
// unrecognized name so a rename/added component can never silently double-count
// or land in the wrong bucket.
export function resolveDatapointSource(
  mapping: InputMappingEntry,
  componentDisplayName: string | undefined,
): keyof AggregatedProductionData {
  if (!mapping.sourceByComponent) return mapping.source;
  const normalized = normalizeComponentDisplayName(componentDisplayName);
  const resolved = ownValue(mapping.sourceByComponent, normalized);
  if (!resolved) {
    const expected = Object.keys(mapping.sourceByComponent)
      .map((k) => `"${k}"`)
      .join(", ");
    throw new SafeError(
      `The pyrolysis diesel component is not recognized. Rename it in Isometric to one of these names: ${expected}.`,
    );
  }
  return resolved;
}

// Tuples that lived in INPUT_MAPPING as `zeroStub: true` families before ADR
// 0005. Their data lives as `PROJECT`-scope Components authored and sourced
// entirely in the Isometric UI (ADR 0018 - noma keeps no copy), except for an
// explicitly named component in a mapping's `sourceByComponent` carve-out. A
// Removal Template that declares any other component for these tuples is wrong
// by construction. `buildCreateDatapointRequest` consults this set before the
// INPUT_MAPPING lookup, so a conflicting entry without a named carve-out can
// never bypass the guard and the resulting `SafeError` names the canonical
// scope rather than just "missing mapping".
//
// Keys mirror the deleted INPUT_MAPPING entries exactly. The category
// strings are self-contained literals — this table is the guard's only
// source of truth (ADR 0018).
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
  // Template component display name. A period tuple is released from the
  // PROJECT-scope guard ONLY when an INPUT_MAPPING entry for the same triple
  // names this exact component in `sourceByComponent` - i.e. the carve-out is
  // per component, never per tuple. Omitting the name keeps the guard armed
  // (fail-closed default).
  componentDisplayName?: string,
): { category: string } | undefined {
  const tuple = lookupThreeLevelValue(
    PERIOD_INPUT_TUPLES,
    groupKey,
    blueprintKey,
    inputKey,
  );
  if (!tuple) return undefined;
  const carveOut = lookupInputMapping(groupKey, blueprintKey, inputKey)
    ?.sourceByComponent;
  const normalized = normalizeComponentDisplayName(componentDisplayName);
  if (carveOut && ownValue(carveOut, normalized)) return undefined;
  return tuple;
}

// Sha256 hex of every mapping that controls a removal body: ordinary
// aggregation→Datapoint inputs plus source-aware sequestration inputs.
// Computed once at module load and embedded in every submitRemoval semantic
// hash, payloadSnapshot, and sync event so a binding change supersedes the prior
// removal version. PROJECT-scope is omitted by design (ADR 0018).
function declarativeInputMappingRevision(
  mapping: InputMappingTable,
): Record<string, unknown> {
  const groups: Record<string, unknown> = {};
  for (const [groupKey, blueprints] of Object.entries(mapping)) {
    const declarativeBlueprints: Record<string, unknown> = {};
    for (const [blueprintKey, inputs] of Object.entries(blueprints)) {
      const declarativeInputs: Record<string, unknown> = {};
      for (const [inputKey, entry] of Object.entries(inputs)) {
        const { transform, transformRevision, ...declarativeEntry } = entry;
        if (transform && !transformRevision) {
          throw new Error(
            `Input mapping ${groupKey}/${blueprintKey}/${inputKey} has a transform without a transformRevision`,
          );
        }
        if (!transform && transformRevision) {
          throw new Error(
            `Input mapping ${groupKey}/${blueprintKey}/${inputKey} has a transformRevision without a transform`,
          );
        }
        declarativeInputs[inputKey] = transform
          ? { ...declarativeEntry, transformRevision }
          : declarativeEntry;
      }
      declarativeBlueprints[blueprintKey] = declarativeInputs;
    }
    groups[groupKey] = declarativeBlueprints;
  }
  return groups;
}

export const MAPPING_REVISION_INPUT = {
  productionClaimPolicy: "application-slice-delivery-only-v1",
  inputMapping: declarativeInputMappingRevision(INPUT_MAPPING),
  sequestrationComponentInputBindings:
    SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
};

export const MAPPING_REVISION: string = payloadHash(MAPPING_REVISION_INPUT);

export interface BuildCreateDatapointArgs {
  groupKey: string;
  componentBlueprintKey: string;
  // Template component display name — the discriminator when one
  // (group, blueprint, input) triple is declared by more than one component
  // (see InputMappingEntry.sourceByComponent). Ignored for single-component
  // triples; omitting it for a shared triple fails closed (never mis-buckets).
  componentDisplayName?: string;
  rtcInput: GhgEntryTemplateComponentInput;
  blueprintInput: ComponentBlueprintInput;
  agg: AggregatedProductionData;
  projectId: string;
  supplierRefId: string;
  // Resolved Isometric Source IDs intended for this exact Datapoint target.
  sourceIds?: string[];
  // Sandbox escape hatch (default false). When a Removal Template still
  // declares a PERIOD_INPUT_TUPLES input — which ADR 0005 says belongs to a
  // PROJECT-scope Component, not a Removal datapoint — the default behaviour
  // is to fail closed with the scope-conflict SafeError below. When this flag
  // is set, the builder instead emits a 0-magnitude REPORTED stub so the
  // submit pipeline can be exercised before the real LCA value exists.
  // `submitRemoval` only sets it for the SANDBOX environment, so a false `0`
  // can never reach a production credit. Tracked in docs/open-questions.md
  // ("stakeholder ask: why do we not have this data, and is an interim 0
  // acceptable?"). Remove once the operator publishes the real value as a
  // Project Component and the template drops the input (ADR 0018).
  allowPeriodInputStub?: boolean;
}

export function buildCreateDatapointRequest(
  args: BuildCreateDatapointArgs,
): components["schemas"]["CreateDatapointRequest"] {
  const {
    groupKey,
    componentBlueprintKey,
    componentDisplayName,
    rtcInput,
    blueprintInput,
    agg,
    projectId,
    supplierRefId,
    sourceIds,
    allowPeriodInputStub,
  } = args;
  const inputKey = rtcInput.input_key;
  const componentLabel =
    componentDisplayName?.trim() &&
    !componentDisplayName.includes("_") &&
    !componentDisplayName.includes("/")
      ? componentDisplayName
      : "selected template component";

  // ADR 0005 §3 / ADR 0018 — scope-conflict check fires BEFORE the
  // INPUT_MAPPING lookup, not just before the missing-entry error: the
  // fail-closed guard must hold even if a future merge re-adds a period
  // tuple to INPUT_MAPPING. PROJECT-scope tuples always win.
  const periodTuple = lookupPeriodInputTuple(
    groupKey,
    componentBlueprintKey,
    inputKey,
    componentDisplayName,
  );
  if (periodTuple) {
    // Sandbox-only escape hatch. The real fix is removing this input from
    // the Removal Template (ADR 0005); until the LCA value exists we let
    // sandbox submit a 0-magnitude stub so the pipeline can be exercised.
    // NOTE: 0 is an *over-claim* for these positive emissions — it is NOT a
    // neutral placeholder — which is exactly why production fails closed.
    if (allowPeriodInputStub) {
      return {
        description:
          `Sandbox 0-stub for project-scope period input ` +
          `"${groupKey}/${componentBlueprintKey}/${inputKey}" ` +
          `(category="${periodTuple.category}"). A real LCA value is still required. ` +
          `See ADR 0018 + docs/open-questions.md. Production fails closed.`,
        display_name: blueprintInput.input_key,
        project_id: projectId,
        quantity: { magnitude: 0, unit: blueprintInput.compatible_unit },
        source_ids: sourceIds ?? [],
        supplier_reference_id: supplierRefId,
        type: "REPORTED",
      };
    }
    const carveOut =
      lookupInputMapping(groupKey, componentBlueprintKey, inputKey)
        ?.sourceByComponent;
    const recognizedCarveOuts = carveOut
      ? Object.keys(carveOut)
          .map((name) => `"${name}"`)
          .join(", ")
      : null;
    throw new SafeError(
      `Registry component ${componentLabel} belongs at the project level, so it cannot be submitted with this Removal. Remove it from the Removal template, then add the project emissions in Isometric.` +
        (recognizedCarveOuts
          ? ` This registry field can stay at Removal scope only when the component is named ${recognizedCarveOuts}.`
          : ""),
    );
  }

  const mapping = lookupInputMapping(groupKey, componentBlueprintKey, inputKey);
  if (!mapping) {
    throw new RegistryMappingError(
      `Registry component ${componentLabel} is not supported. Ask support to update the registry mapping before submitting.`,
      componentBlueprintKey,
      inputKey,
      groupKey,
    );
  }
  if (mapping.expectedQuantityKind !== blueprintInput.quantity_kind) {
    throw new SafeError(
      `Registry component ${componentLabel} uses an unsupported value type. Ask support to check the registry mapping before submitting.`,
    );
  }
  if (
    mapping.unit.toLowerCase() !== blueprintInput.compatible_unit.toLowerCase()
  ) {
    throw new SafeError(
      `Registry component ${componentLabel} uses a different unit from the saved mapping. Ask support to update the registry mapping.`,
    );
  }

  const source = resolveDatapointSource(mapping, componentDisplayName);
  const raw = agg[source];
  if (raw == null) {
    throw new SafeError(
      `Removal data has no calculated value for registry component ${componentLabel}. Check the source records before submitting.`,
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
    source_ids: sourceIds ?? [],
    supplier_reference_id: supplierRefId,
    type: mapping.datapointType,
  };
}
