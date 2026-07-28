import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import { buildRemovalSupplierRef } from "../utils/supplier-ref";
import { encodeMeasurementProperty } from "../utils/measurement-property";
import {
  CARBON_CONTENTS_MEASUREMENT_PROPERTY,
  isSequestrationBlueprintFamily,
  PRODUCT_MASS_MEASUREMENT_PROPERTY,
  S_FRACTION_MEASUREMENT_PROPERTY,
  SEQUESTRATION_BLUEPRINT_1000_YEAR,
} from "./measurement-sample";

type GhgEntryTemplate = components["schemas"]["GhgEntryTemplate"];
type InputDataShape = components["schemas"]["InputDataShape"];
type MeasurementProperty = components["schemas"]["MeasurementProperty"];
type QuantityKind = components["schemas"]["QuantityKindType"];
type DatapointType = components["schemas"]["DatapointType"];
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
  ) {
    super(message);
    this.name = "RegistryMappingError";
  }
}

const S_FRACTION_MIN = 0;
const S_FRACTION_MAX = 1;
const LEGACY_SEQUESTRATION_BLUEPRINT_KEY =
  "carbon_rich_substance_sequestration";

interface MeasurementPropertyInputBinding {
  dataShape: InputDataShape;
  source: "measurement-property";
  measurementProperty: MeasurementProperty;
}

interface DirectDatapointInputBinding {
  dataShape: InputDataShape;
  source: "direct-datapoint";
  /**
   * The measurement-sample property carrying the same raw replicate magnitude.
   * The sample remains data-quality evidence; it is not the GHG-entry binding.
   */
  evidenceMeasurementProperty: MeasurementProperty;
  quantityKind: QuantityKind;
  unit: string;
  datapointType: DatapointType;
}

export type SequestrationInputBinding =
  | MeasurementPropertyInputBinding
  | DirectDatapointInputBinding;

interface SequestrationBlueprintBinding {
  inputs: Readonly<Record<string, SequestrationInputBinding>>;
}

interface MeasurementSampleSubmission {
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
 * Explicit component-input bindings confirmed for the live 1000-year removal
 * template. Each input declares whether the GHG entry consumes a datapoint
 * returned by a measurement sample or a direct datapoint posted by the removal
 * orchestrator. This table deliberately owns the input shapes because
 * `biochar_sequestration_1000_year` is referenced by the live template but
 * absent from the component-blueprint catalog.
 */
export const SEQUESTRATION_COMPONENT_INPUT_BINDINGS = {
  [SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
    inputs: {
      carbon_contents: {
        dataShape: "LIST",
        source: "measurement-property",
        measurementProperty: CARBON_CONTENTS_MEASUREMENT_PROPERTY,
      },
      product_mass: {
        dataShape: "SCALAR",
        source: "measurement-property",
        measurementProperty: PRODUCT_MASS_MEASUREMENT_PROPERTY,
      },
      s_fraction: {
        dataShape: "LIST",
        source: "direct-datapoint",
        evidenceMeasurementProperty: S_FRACTION_MEASUREMENT_PROPERTY,
        // CreateDatapointRequest expresses quantity kind through its unit. The
        // literal `dimensionless` unit resolves to the template's
        // `dimensionless` kind, unlike the sample property's
        // `dimensionless_ratio` kind.
        quantityKind: "dimensionless",
        unit: "dimensionless",
        datapointType: "REPORTED",
      },
    },
  },
} as const satisfies Readonly<Record<string, SequestrationBlueprintBinding>>;

export function hasExplicitSequestrationBinding(
  blueprintKey: string,
): boolean {
  return blueprintKey in SEQUESTRATION_COMPONENT_INPUT_BINDINGS;
}

export function getSequestrationInputBinding(
  blueprintKey: string,
  inputKey: string,
): SequestrationInputBinding | null {
  const blueprintBinding = (
    SEQUESTRATION_COMPONENT_INPUT_BINDINGS as Readonly<
      Record<string, SequestrationBlueprintBinding>
    >
  )[blueprintKey];
  return blueprintBinding?.inputs[inputKey] ?? null;
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
  const blueprintBinding = (
    SEQUESTRATION_COMPONENT_INPUT_BINDINGS as Readonly<
      Record<string, SequestrationBlueprintBinding>
    >
  )[component.blueprint_key];

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
 * Builds the direct-datapoint sources declared by the binding table. Values are
 * read from their matching measurement-sample evidence entries so the direct
 * datapoint magnitude and retained evidence cannot diverge. Supplier refs use
 * the same versioned per-removal scheme as ordinary emissions datapoints.
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

        const propertyKey = encodeMeasurementProperty(
          binding.evidenceMeasurementProperty,
        );
        let directIndex = 0;
        for (const submission of args.measurementSampleSubmissions) {
          for (
            let valueIndex = 0;
            valueIndex < submission.body.values.length;
            valueIndex += 1
          ) {
            const sampleValue = submission.body.values[valueIndex];
            if (
              encodeMeasurementProperty(sampleValue.measurement_property) !==
              propertyKey
            ) {
              continue;
            }
            const magnitude = sampleValue.value.magnitude;
            if (
              !Number.isFinite(magnitude) ||
              magnitude < S_FRACTION_MIN ||
              magnitude > S_FRACTION_MAX
            ) {
              throw new SafeError(
                `Registry measurement ${submission.supplierRefId} has value ${String(magnitude)}, outside ${S_FRACTION_MIN} to ${S_FRACTION_MAX}. Record a value in this range.`,
              );
            }

            const supplierReferenceKey =
              `${component.id}-${rtcInput.input_key}-` +
              `${submission.operationKey}-${valueIndex}`;
            directDatapoints.push({
              rtcId: component.id,
              inputKey: rtcInput.input_key,
              body: {
                description:
                  `Direct ${rtcInput.input_key} replicate ${directIndex + 1} ` +
                  `from measurement-sample evidence ${submission.supplierRefId}`,
                display_name: rtcInput.input_key,
                ...(submission.body.measured_at
                  ? { measured_at: submission.body.measured_at }
                  : {}),
                project_id: args.projectId,
                quantity: {
                  magnitude,
                  unit: binding.unit,
                },
                source_ids: [...args.sourceIds],
                supplier_reference_id: buildRemovalSupplierRef({
                  removalId: args.removalId,
                  role: "datapoint",
                  version: args.version,
                  inputKey: supplierReferenceKey,
                }),
                type: binding.datapointType,
              },
            });
            directIndex += 1;
          }
        }

        if (directIndex === 0) {
          throw new SafeError(
            "The selected Removal template has no value from the durability evidence. Check the Samples before submitting.",
          );
        }
        if (binding.dataShape === "SCALAR" && directIndex !== 1) {
          throw new SafeError(
            `A durability field accepts one value but received ${directIndex}. Ask support to check the registry mapping.`,
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
    }
  }

  return datapointIdsByRtcInput;
}

function assertSupportedSequestrationBlueprint(blueprintKey: string): void {
  if (hasExplicitSequestrationBinding(blueprintKey)) return;
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
