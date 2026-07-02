import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import type { AggregatedProductionData } from "../utils/aggregation";
import { payloadHash } from "../utils/payload-hash";

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

  // Biochar → storage transport (biochar product leg category). Same
  // mass_distance (tonne·km) model as feedstock transport above.
  "biochar-transport": {
    mass_distance_based_ci_emissions: {
      mass_distance: {
        source: "biocharTransportMassDistanceTonneKm",
        unit: "tonne * km",
        datapointType: "REPORTED",
        expectedQuantityKind: "mass_distance",
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
      },
    },
  },

  // Pyrolysis energy — single combined measurement point (ADR 0015). The
  // operator re-authored the template so all energy enters here as two
  // scalars: grid electricity (`grid_electricity_use`) and diesel genset
  // (`energy_based_ci_emissions`). noma submits the run-combined totals with
  // NO per-stage split — feedstock-processing and biochar-processing cannot be
  // metered separately, so there is nothing to apportion. `totalElectricityKwh`
  // is the combined grid figure; `totalGensetKwh` is genset litres × the
  // facility's genset yield (computed in `enrichWithFacilityConfig`). The
  // former per-stage `metered_energy_based_ci_emissions` electricity entry and
  // the `biochar-processing` / `biomass-feedstock-processing` energy entries
  // are gone (those components no longer exist in the template).
  pyrolysis: {
    grid_electricity_use: {
      electricity_use: {
        source: "totalElectricityKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
    energy_based_ci_emissions: {
      energy: {
        source: "totalGensetKwh",
        unit: "kWh",
        datapointType: "REPORTED",
        expectedQuantityKind: "energy",
      },
    },
  },

  // Five blueprint families that used to live here as zero stubs
  // (`staff-travel/distance_based_ci_emissions`,
  // `direct-emissions/ghg_direct_emissions` × 2 inputs,
  // `biochar-storage/fuel_usage_by_volume`,
  // `miscellaneous/mass_based_ci_emissions`) and two more under
  // `sampling-required-for-mrv` moved to PROJECT scope as Project
  // Components per ADR 0005. They are listed in PERIOD_INPUT_TUPLES below;
  // a Removal Template that declares any of them as REMOVAL-scope trips
  // the scope-conflict SafeError in buildCreateDatapointRequest.

  // Startup / plant diesel — volume-based. `totalStartupDieselLitres`
  // excludes genset diesel (that flows through the energy-based genset
  // components above), so diesel is never double-counted.
  "biomass-feedstock-sourcing": {
    fuel_usage_by_volume: {
      volume_of_fuel: {
        source: "totalStartupDieselLitres",
        unit: "l",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
      },
    },
  },
  // Startup/plant diesel also maps here when a template carries the volume
  // component. The live operator template (ADR 0015) declares no
  // `fuel_usage_by_volume` component in this group, so the value is not
  // submitted; a non-blocking warning fires instead (see
  // `buildSubmissionWarnings` in certify-context-core.ts). The mapping stays
  // for templates that DO carry the component (e.g. the protocol default).
  "biomass-feedstock-processing": {
    fuel_usage_by_volume: {
      volume_of_fuel: {
        source: "totalStartupDieselLitres",
        unit: "l",
        datapointType: "REPORTED",
        expectedQuantityKind: "volume",
      },
    },
  },

  // (The previous `miscellaneous` zero-stub family moved to PROJECT scope
  // per ADR 0005.)
};

export function lookupInputMapping(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): InputMappingEntry | undefined {
  return INPUT_MAPPING[groupKey]?.[blueprintKey]?.[inputKey];
}

// Tuples that used to live in INPUT_MAPPING as `zeroStub: true` families
// before ADR 0005. Their data lives as `PROJECT`-scope Components authored
// and sourced entirely in the Isometric UI (ADR 0018 — noma keeps no copy);
// a Removal Template that declares any of them as REMOVAL-scope is
// wrong by construction. `buildCreateDatapointRequest` consults this set
// before the INPUT_MAPPING lookup, so a conflicting mapping entry can never
// bypass the guard and the resulting `SafeError` names the canonical scope
// rather than just "missing mapping".
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
): { category: string } | undefined {
  return PERIOD_INPUT_TUPLES[groupKey]?.[blueprintKey]?.[inputKey];
}

// Sha256 hex of the canonical-JSON serialisation of INPUT_MAPPING. Computed
// once at module load and embedded in every submitRemoval-emitted
// payloadSnapshot + sync event so an Isometric-side issue correlates to a
// specific noma mapping revision (Plan §6 / B3). PROJECT-scope is omitted
// from this hash by design — those values don't flow through this table
// (ADR 0018: they live only in Isometric).
export const MAPPING_REVISION: string = payloadHash(INPUT_MAPPING);

export interface BuildCreateDatapointArgs {
  groupKey: string;
  componentBlueprintKey: string;
  rtcInput: GhgEntryTemplateComponentInput;
  blueprintInput: ComponentBlueprintInput;
  agg: AggregatedProductionData;
  projectId: string;
  supplierRefId: string;
  // Resolved Isometric Source IDs to attach to this Datapoint. Phase 3.5 ships
  // removal-wide attribution: every Datapoint receives the same list, which
  // means the verifier sees full evidence per Datapoint but does not see
  // per-input narrowing. Per-input attribution is a Phase 5 follow-up tracked
  // in docs/open-questions.md `isometric/sources-per-input-attribution`.
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
    rtcInput,
    blueprintInput,
    agg,
    projectId,
    supplierRefId,
    sourceIds,
    allowPeriodInputStub,
  } = args;
  const inputKey = rtcInput.input_key;

  // ADR 0005 §3 / ADR 0018 — scope-conflict check fires BEFORE the
  // INPUT_MAPPING lookup, not just before the missing-entry error: the
  // fail-closed guard must hold even if a future merge re-adds a period
  // tuple to INPUT_MAPPING. PROJECT-scope tuples always win.
  const periodTuple = lookupPeriodInputTuple(
    groupKey,
    componentBlueprintKey,
    inputKey,
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
          `(category="${periodTuple.category}") — pending real LCA value. ` +
          `See ADR 0018 + docs/open-questions.md. Production fails closed.`,
        display_name: blueprintInput.input_key,
        project_id: projectId,
        quantity: { magnitude: 0, unit: blueprintInput.compatible_unit },
        source_ids: sourceIds ?? [],
        supplier_reference_id: supplierRefId,
        type: "REPORTED",
      };
    }
    throw new SafeError(
      `This input belongs to a Project-scope Component (PROJECT scope, category="${periodTuple.category}"). ` +
        `Remove "${groupKey}/${componentBlueprintKey}/${inputKey}" from the Removal Template; publish this emission as a Project Component in the Isometric UI, with the source LCA PDF attached to its Sources field (ADR 0018).`,
    );
  }

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
    source_ids: sourceIds ?? [],
    supplier_reference_id: supplierRefId,
    type: mapping.datapointType,
  };
}
