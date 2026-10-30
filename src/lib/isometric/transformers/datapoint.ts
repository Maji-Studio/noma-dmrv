import { aggregatedProductionRunDatapointDescription, carriedEntryDatapointDescription, type CarriedEntryNote } from "@/lib/certification/emission-entry-carry-copy";
import { sumFigures, type EmissionFigure } from "@/lib/certification/emission-lines";
import { canonicalUnit } from "../template-observations/units";
import { effectiveContract } from "../template-observations/line-sources";
import { removalLineBlockerMessage } from "@/lib/certification/removal-blockers";
import { emissionLineBindingDecision } from "@/lib/certification/emission-line-binding";
import { type LineContract } from "../template-observations/line-sources";
import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import type { AggregatedProductionData } from "../utils/aggregation";
import { payloadHash } from "../utils/payload-hash";
import {
  type InputMappingTable,
  type SequestrationBindingTable,
} from "../semantic-binding-projections";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "../storage-blueprints";
import {
  RegistryMappingError,
  SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
} from "./sequestration-binding";

type ComponentBlueprintInput = components["schemas"]["ComponentBlueprintInput"];
type GhgEntryTemplateComponentInput =
  components["schemas"]["GhgEntryTemplateComponentInput"];

export type { InputMappingEntry, InputMappingTable } from "../semantic-binding-projections";

import { INPUT_MAPPING, lookupInputMapping, lookupPeriodInputTuple, resolveDatapointSource } from "../datapoint-mapping";
export { INPUT_MAPPING, lookupInputMapping, lookupPeriodInputTuple, resolveDatapointSource } from "../datapoint-mapping";

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

type MappingRevisionSequestrationBindings = SequestrationBindingTable;

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

const PRODUCTION_CLAIM_POLICY = "application-slice-delivery-entry-carry-v5";

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
  // Display label for operator messages only.
  componentDisplayName?: string;
  lineContract?: LineContract;
  entryContribution?: EmissionFigure;
  carriedEntries?: readonly CarriedEntryNote[];
  omitAutomaticProduction?: boolean;
  rtcInput: GhgEntryTemplateComponentInput;
  blueprintInput: ComponentBlueprintInput;
  agg: AggregatedProductionData;
  projectId: string;
  supplierRefId: string;
  // Resolved Isometric Source IDs intended for this exact Datapoint target.
  sourceIds?: string[];
}

export function buildCreateDatapointRequest(
  args: BuildCreateDatapointArgs,
): components["schemas"]["CreateDatapointRequest"] {
  const {
    groupKey,
    componentBlueprintKey,
    componentDisplayName,
    lineContract,
    rtcInput,
    blueprintInput,
    agg,
    projectId,
    supplierRefId,
    sourceIds,
  } = args;
  if (lineContract) {
    const decision = emissionLineBindingDecision({ groupKey, contract: lineContract, problems: [], enrichmentComplete: true, entriesCanSubmit: !!args.entryContribution,
      component: { id: "", displayName: componentDisplayName ?? "", description: null, blueprintKey: componentBlueprintKey,
        inputs: [{ key: rtcInput.input_key, type: rtcInput.type, quantityKind: rtcInput.quantity_kind }] } });
    if (decision) throw new SafeError(removalLineBlockerMessage(decision.blocker));
  }
  const contract = lineContract && effectiveContract(lineContract);
  if (args.entryContribution) {
    if (contract?.scope !== "operating" || contract.entryPolicy === "none") throw new SafeError("This component does not take manual entries.");
    const unit = canonicalUnit(blueprintInput.quantity_kind, blueprintInput.compatible_unit);
    if (!unit || args.entryContribution.unit !== unit || rtcInput.quantity_kind !== blueprintInput.quantity_kind) throw new SafeError("The emissions entry unit does not match this template input.");
    let figure = args.entryContribution;
    const mapping = lookupInputMapping(groupKey, componentBlueprintKey, rtcInput.input_key, lineContract);
    if (contract.automaticSource && mapping && agg[resolveDatapointSource(mapping, lineContract)] != null && !(args.omitAutomaticProduction && mapping?.bucket === "production")) {
      const automatic = buildCreateDatapointRequest({ ...args, entryContribution: undefined });
      const automaticUnit = canonicalUnit(blueprintInput.quantity_kind, automatic.quantity.unit ?? "");
      figure = sumFigures([figure, { magnitude: String(automatic.quantity.magnitude), unit: automaticUnit ?? "" }])!;
    }
    const magnitude = Number(figure.magnitude);
    if (!Number.isFinite(magnitude)) throw new SafeError("The emissions entry value is too large to submit.");
    return { description: carriedEntryDatapointDescription(args.carriedEntries ?? []), display_name: blueprintInput.input_key, project_id: projectId,
      quantity: { magnitude, unit: blueprintInput.compatible_unit }, source_ids: sourceIds ?? [], supplier_reference_id: supplierRefId, type: "REPORTED" };
  }
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
    lineContract,
  );
  if (periodTuple) {
    throw new SafeError(
      `Registry component ${componentLabel} belongs at the project level, so it cannot be submitted with this Removal. Remove it from the Removal template, then add the project emissions in Isometric.`,
    );
  }

  const mapping = lookupInputMapping(groupKey, componentBlueprintKey, inputKey, lineContract);
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

  const source = resolveDatapointSource(mapping, lineContract);
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
    description: aggregatedProductionRunDatapointDescription(agg.sourceProductionRunIds),
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
