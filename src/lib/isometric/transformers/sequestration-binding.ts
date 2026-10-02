import { SafeError } from "@/lib/errors";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import type { components } from "../generated/certify";
import { buildRemovalSupplierRef } from "../utils/supplier-ref";
import { encodeMeasurementProperty } from "../utils/measurement-property";
import { ownValue } from "../semantic-binding-catalog";
import {
  lookupMeasurementSampleTransform,
  projectSequestrationInputBindings,
  type SequestrationBindingTable,
  type SequestrationInputBinding,
} from "../semantic-binding-projections";
import {
  classifySequestration1000YearComponent,
  CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  isSequestrationBlueprintFamily,
  LEGACY_SEQUESTRATION_BLUEPRINT_KEY,
} from "../storage-blueprints";

export type { SequestrationInputBinding };

type GhgEntryTemplate = components["schemas"]["GhgEntryTemplate"];
type CreateDatapointRequest =
  components["schemas"]["CreateDatapointRequest"];
type CreateMeasurementSampleRequest =
  components["schemas"]["CreateMeasurementSampleRequest"];

export type DatapointIdsByRtcInput = Map<string, string[]>;
export type DatapointIdsByMeasurementProperty = Map<string, string[]>;

export class RegistryMappingError extends SafeError {
  constructor(
    message: string,
    readonly blueprintKey: string,
    readonly inputKey: string,
    readonly groupKey?: string,
  ) {
    super(message);
    this.name = "RegistryMappingError";
  }
}

const MISSING_DURABILITY_EVIDENCE_MESSAGE =
  "The selected Removal template has no value from the durability evidence. Check the Samples before submitting.";

interface MeasurementSampleSubmission {
  creditBatchId: string;
  sampleId: string;
  creditBatchProductMassKg: number;
  operationKey: string;
  supplierRefId: string;
  body: CreateMeasurementSampleRequest;
}

export interface DirectSequestrationDatapoint {
  rtcId: string;
  inputKey: string;
  body: CreateDatapointRequest;
}

/**
 * Explicit component-input bindings for the storage components noma submits:
 * a projection of the semantic binding catalog's measurement-sample roles.
 * Each input declares whether the GHG entry consumes a datapoint returned by a
 * measurement sample or a direct datapoint posted by the removal orchestrator.
 */
export const SEQUESTRATION_COMPONENT_INPUT_BINDINGS: SequestrationBindingTable =
  projectSequestrationInputBindings();

export function hasExplicitSequestrationBinding(
  blueprintKey: string,
): boolean {
  return ownValue(SEQUESTRATION_COMPONENT_INPUT_BINDINGS, blueprintKey) !== undefined;
}

/**
 * Configuration-time guard for newly selected templates. Historical snapshots
 * remain readable, but operators cannot bind a deprecated or unsupported
 * Method-B 1,000-year component as the facility default.
 */
export function assertSequestrationTemplateSelectable(
  template: GhgEntryTemplate,
): void {
  for (const component of template.groups.flatMap((group) => group.components)) {
    const classification = classifySequestration1000YearComponent(
      component.blueprint_key,
    );
    if (classification === "deprecated") {
      throw new SafeError(
        "The selected template uses the legacy 1,000-year component with total-carbon and uncapped durability semantics. Select a template using biochar_sequestration_1000_year_f_durable_max.",
      );
    }
    if (classification === "unsupported-unsampled") {
      throw new SafeError(
        "The selected template uses the unsampled 1,000-year component. Unsampled Method B is not supported; select the sampled 1,000-year template.",
      );
    }
  }
}

export function getSequestrationInputBinding(
  blueprintKey: string,
  inputKey: string,
): SequestrationInputBinding | null {
  const blueprintBinding = ownValue(SEQUESTRATION_COMPONENT_INPUT_BINDINGS, blueprintKey);
  return (blueprintBinding && ownValue(blueprintBinding.inputs, inputKey)) ?? null;
}

/** Applies the transform the active binding declares. */
export function transformSequestrationSourceValue(
  blueprintKey: string,
  inputKey: string,
  value: number,
): number {
  const transform = lookupMeasurementSampleTransform(blueprintKey, inputKey);
  if (!transform) {
    throw missingInputBindingError(blueprintKey, inputKey);
  }
  return transform.apply(value);
}

/**
 * Validates the live removal-template shape before any registry mutation.
 * A Removal has exactly one sequestration contribution; accepting zero would
 * recreate the emissions-only bug, while accepting duplicates would bind the
 * same evidence twice and overstate storage.
 */
export function assertSequestrationTemplateBindings(
  template: GhgEntryTemplate,
): void {
  const templateComponents = template.groups.flatMap(
    (group) => group.components,
  );
  const components = templateComponents.filter((component) =>
      isSequestrationBlueprintFamily(component.blueprint_key),
  );
  const legacyComponents = templateComponents.filter(
    (component) =>
      component.blueprint_key === LEGACY_SEQUESTRATION_BLUEPRINT_KEY,
  );
  const storageComponentCount =
    components.length + legacyComponents.length;
  if (storageComponentCount !== 1) {
    throw new SafeError(
      `Removal template "${template.display_name}" must contain one supported storage component. It contains ${storageComponentCount}. Choose another template.`,
    );
  }
  if (legacyComponents.length === 1) return;

  const component = components[0];
  assertSupportedSequestrationBlueprint(component.blueprint_key);
  const blueprintBinding = SEQUESTRATION_COMPONENT_INPUT_BINDINGS[component.blueprint_key];

  for (const input of component.inputs) {
    if (!blueprintBinding.inputs[input.input_key]) {
      throw missingInputBindingError(
        component.blueprint_key,
        input.input_key,
      );
    }
  }

  for (const [inputKey, binding] of Object.entries(blueprintBinding.inputs)) {
    const declared = component.inputs.filter(
      (input) => input.input_key === inputKey,
    );
    if (declared.length !== 1) {
      throw new SafeError(
        `The selected Removal template must contain one value for each required durability field. One field contains ${declared.length}. Ask an Admin to update the template.`,
      );
    }
    const input = declared[0];
    if (input.type !== "monitored") {
      throw new SafeError(
        "A durability field in the selected Removal template must use recorded values. Ask an Admin to update the template.",
      );
    }
    const expectedQuantityKind =
      binding.source === "measurement-property"
        ? binding.measurementProperty.quantity_kind
        : binding.quantityKind;
    if (input.quantity_kind !== expectedQuantityKind) {
      throw new SafeError(
        "A durability field in the selected Removal template uses the wrong measurement type. Ask an Admin to update the template.",
      );
    }
  }
}

/**
 * Builds the direct-datapoint sources declared by the binding table. Credit-batch
 * product mass is transported independently of any physical Sample. Supplier refs
 * use the same versioned per-removal scheme as ordinary emissions datapoints.
 */
export function buildDirectSequestrationDatapoints(args: {
  template: GhgEntryTemplate;
  measurementSampleSubmissions: MeasurementSampleSubmission[];
  projectId: string;
  removalId: string;
  version: number;
  sourceIds: string[];
}): DirectSequestrationDatapoint[] {
  const directDatapoints: DirectSequestrationDatapoint[] = [];

  for (const group of args.template.groups) {
    for (const component of group.components) {
      if (!isSequestrationBlueprintFamily(component.blueprint_key)) continue;
      assertSupportedSequestrationBlueprint(component.blueprint_key);

      for (const rtcInput of component.inputs) {
        const binding = getSequestrationInputBinding(
          component.blueprint_key,
          rtcInput.input_key,
        );
        if (!binding) {
          throw missingInputBindingError(
            component.blueprint_key,
            rtcInput.input_key,
          );
        }
        if (binding.source !== "direct-datapoint") continue;

        if (args.measurementSampleSubmissions.length === 0) {
          throw new SafeError(MISSING_DURABILITY_EVIDENCE_MESSAGE);
        }
        const massByCreditBatchId = new Map<string, number>();
        for (const submission of args.measurementSampleSubmissions) {
          const existing = massByCreditBatchId.get(submission.creditBatchId);
          if (
            existing !== undefined &&
            existing !== submission.creditBatchProductMassKg
          ) {
            throw new SafeError(
              `Credit batch ${submission.creditBatchId} has inconsistent product mass across its Samples. Refresh the Removal and try again.`,
            );
          }
          massByCreditBatchId.set(
            submission.creditBatchId,
            submission.creditBatchProductMassKg,
          );
        }
        for (const [creditBatchId, magnitude] of Array.from(
          massByCreditBatchId,
        ).sort(([left], [right]) => left.localeCompare(right))) {
          if (!Number.isFinite(magnitude) || magnitude < 0) {
            throw new SafeError(
              `Credit batch ${creditBatchId} has invalid product mass. Correct the applied mass before submitting.`,
            );
          }
          directDatapoints.push({
            rtcId: component.id,
            inputKey: rtcInput.input_key,
            body: {
              description: `Direct product mass for credit batch ${creditBatchId}`,
              display_name: rtcInput.input_key,
              project_id: args.projectId,
              quantity: { magnitude, unit: binding.unit },
              source_ids: [...args.sourceIds],
              supplier_reference_id: buildRemovalSupplierRef({
                removalId: args.removalId,
                role: "datapoint",
                version: args.version,
                inputKey: `${component.id}-${rtcInput.input_key}-${creditBatchId}`,
              }),
              type: binding.datapointType,
            },
          });
        }
        if (massByCreditBatchId.size !== 1) {
          throw new SafeError(
            `A durability field accepts one value but received ${massByCreditBatchId.size}. Ask support to check the registry mapping.`,
          );
        }
      }
    }
  }

  return directDatapoints;
}

/**
 * Resolves every sequestration input into the `${rtcId}::${inputKey}` structure
 * consumed by the GHG-entry transformer. Measurement-property inputs are
 * captured from sample responses; direct-datapoint inputs must already have
 * been posted by the orchestrator. Unknown or missing sources fail loudly:
 * omission would create an emissions-only, net-negative registry entry.
 */
export function bindSequestrationDatapointsToTemplate(args: {
  template: GhgEntryTemplate;
  datapointIdsByMeasurementProperty: DatapointIdsByMeasurementProperty;
  datapointIdsByRtcInput?: DatapointIdsByRtcInput;
}): DatapointIdsByRtcInput {
  const datapointIdsByRtcInput = new Map(args.datapointIdsByRtcInput);

  for (const group of args.template.groups) {
    for (const component of group.components) {
      if (!isSequestrationBlueprintFamily(component.blueprint_key)) continue;

      assertSupportedSequestrationBlueprint(component.blueprint_key);

      for (const rtcInput of component.inputs) {
        const binding = getSequestrationInputBinding(
          component.blueprint_key,
          rtcInput.input_key,
        );
        if (!binding) {
          throw missingInputBindingError(
            component.blueprint_key,
            rtcInput.input_key,
          );
        }

        const rtcInputKey = `${component.id}::${rtcInput.input_key}`;
        let datapointIds: string[];
        if (binding.source === "measurement-property") {
          const propertyKey = encodeMeasurementProperty(
            binding.measurementProperty,
          );
          datapointIds =
            args.datapointIdsByMeasurementProperty.get(propertyKey) ?? [];
          if (datapointIds.length === 0) {
            throw new SafeError(
              "The selected Removal template has no value from the durability measurement. Refresh the registry data and try again.",
            );
          }
        } else {
          datapointIds = datapointIdsByRtcInput.get(rtcInputKey) ?? [];
          if (datapointIds.length === 0) {
            throw new SafeError(
              "A durability field has no submitted value. Check the Removal data before submitting.",
            );
          }
        }

        if (binding.dataShape === "SCALAR" && datapointIds.length !== 1) {
          throw new SafeError(
            `A durability field accepts one value but received ${datapointIds.length}. Ask support to check the registry mapping.`,
          );
        }

        datapointIdsByRtcInput.set(rtcInputKey, [...datapointIds]);
      }

      if (
        component.blueprint_key === CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR
      ) {
        const listInputKeys = [
          "total_carbon_contents",
          "inorganic_carbon_contents",
          "s_fraction",
        ] as const;
        const listLengths = listInputKeys.map(
          (inputKey) =>
            datapointIdsByRtcInput.get(`${component.id}::${inputKey}`)?.length ??
            0,
        );
        if (
          new Set(listLengths).size !== 1 ||
          listLengths[0] < MINIMUM_REPLICATES_PER_BATCH
        ) {
          throw new SafeError(
            `The current 1,000-year durability component requires equal total-carbon, inorganic-carbon, and R₀ lists with at least ${MINIMUM_REPLICATES_PER_BATCH} values. Refresh the Sample data and try again.`,
          );
        }
      }
    }
  }

  return datapointIdsByRtcInput;
}

function assertSupportedSequestrationBlueprint(blueprintKey: string): void {
  if (hasExplicitSequestrationBinding(blueprintKey)) return;
  const classification = classifySequestration1000YearComponent(blueprintKey);
  if (classification === "deprecated") {
    throw new SafeError(
      "The selected Removal template uses the deprecated 1,000-year durability component. Ask an Admin to select a template using biochar_sequestration_1000_year_f_durable_max.",
    );
  }
  if (classification === "unsupported-unsampled") {
    throw new SafeError(
      "The selected Removal template uses the unsampled 1,000-year durability component. Unsampled Method B is not supported; choose the sampled 1,000-year template.",
    );
  }
  throw new SafeError(
    "The selected Removal template has an unsupported durability component. Choose a template for this facility's durability tier.",
  );
}

function missingInputBindingError(
  blueprintKey: string,
  inputKey: string,
): RegistryMappingError {
  return new RegistryMappingError(
    "The selected Removal template contains an unsupported durability field. Ask support to update the registry mapping before submitting.",
    blueprintKey,
    inputKey,
  );
}
