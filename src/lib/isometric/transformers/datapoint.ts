import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import type { AggregatedProductionData } from "../utils/aggregation";
import { payloadHash } from "../utils/payload-hash";
import {
  projectInputMapping,
  projectPeriodInputTuples,
  type InputMappingEntry,
  type InputMappingTable,
} from "../semantic-binding-catalog";
import {
  RegistryMappingError,
  SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
  type SequestrationInputBinding,
} from "./sequestration-binding";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "./measurement-sample";

type ComponentBlueprintInput = components["schemas"]["ComponentBlueprintInput"];
type GhgEntryTemplateComponentInput =
  components["schemas"]["GhgEntryTemplateComponentInput"];

export type { InputMappingEntry, InputMappingTable };

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

// Maps (group_key, blueprint_key, input_key) tuples to a noma aggregated
// source field. A projection of the semantic binding catalog
// (src/lib/isometric/semantic-binding-catalog.ts), which owns every entry and
// its rationale; edit the catalog, never this table. The 3-level structure is
// required because blueprints repeat across groups with different meaning
// (`mass_distance` is feedstock, biochar or sample transport by group).
//
// Validated against the live blueprint at submit time (see
// buildCreateDatapointRequest) so a key that drifts from the catalog
// surfaces immediately rather than silently producing a malformed datapoint.
export const INPUT_MAPPING: InputMappingTable = projectInputMapping();

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
// A projection of the catalog's project-scope roles (ADR 0018): edit the
// catalog, never this table.
const PERIOD_INPUT_TUPLES = projectPeriodInputTuples();

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

type MappingRevisionSequestrationBindings = Readonly<
  Record<
    string,
    {
      readonly inputs: Readonly<Record<string, SequestrationInputBinding>>;
    }
  >
>;

type SequestrationPresentationRevision = Readonly<
  Record<
    string,
    Readonly<
      Record<
        string,
        { readonly confirmation: string; readonly nomaSource: string }
      >
    >
  >
>;

const LEGACY_SEQUESTRATION_PRESENTATION_REVISION: SequestrationPresentationRevision =
  {
    [CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
      total_carbon_contents: {
        confirmation: "confirmed",
        nomaSource: "Sample totalCarbonPercent[]",
      },
      inorganic_carbon_contents: {
        confirmation: "externally-unconfirmed",
        nomaSource: "Sample inorganicCarbonPercent[]",
      },
      product_mass: {
        confirmation: "confirmed",
        nomaSource: "Attribution-scaled dry applied biochar mass",
      },
      s_fraction: {
        confirmation: "externally-unconfirmed",
        nomaSource: "Sample sReflectanceFraction[]",
      },
    },
  };
const DEFAULT_PRESENTATION_REVISION = {
  confirmation: "diagnostic-only",
  nomaSource: "diagnostic-only",
} as const;

// Revision identity excludes diagnostic/presentation metadata while retaining
// every operative binding field and the source contract's wire semantics. The
// frozen presentation values preserve the revision emitted before this
// normalization existed, so diagnostic corrections do not supersede an
// otherwise unchanged registry submission.
function declarativeSequestrationBindingRevision(
  bindings: MappingRevisionSequestrationBindings,
): Record<string, unknown> {
  const blueprints: Record<string, unknown> = {};
  for (const [blueprintKey, blueprint] of Object.entries(bindings)) {
    const inputs: Record<string, unknown> = {};
    for (const [inputKey, binding] of Object.entries(blueprint.inputs)) {
      const { sourceContract, ...operativeBinding } = binding;
      const presentationRevision =
        LEGACY_SEQUESTRATION_PRESENTATION_REVISION[blueprintKey]?.[inputKey] ??
        DEFAULT_PRESENTATION_REVISION;
      inputs[inputKey] = {
        ...operativeBinding,
        sourceContract: {
          ...presentationRevision,
          transformRevision: sourceContract.transformRevision,
          wireUnit: sourceContract.wireUnit,
        },
      };
    }
    blueprints[blueprintKey] = { inputs };
  }
  return blueprints;
}

const PRODUCTION_CLAIM_POLICY = "application-slice-delivery-only-v1";

export function buildMappingRevisionInput(
  sequestrationBindings: MappingRevisionSequestrationBindings =
    SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
): Record<string, unknown> {
  return {
    productionClaimPolicy: PRODUCTION_CLAIM_POLICY,
    inputMapping: declarativeInputMappingRevision(INPUT_MAPPING),
    sequestrationComponentInputBindings:
      declarativeSequestrationBindingRevision(sequestrationBindings),
  };
}

export const MAPPING_REVISION_INPUT = buildMappingRevisionInput();

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
