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
      `Removal template "${template.display_name}" must contain exactly one supported sequestration component; found ${storageComponentCount}.`,
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
        `Sequestration component ${component.id} must declare input "${inputKey}" exactly once; found ${declared.length}.`,
      );
    }
    const input = declared[0];
    if (input.type !== "monitored") {
      throw new SafeError(
        `Sequestration component ${component.id} input "${inputKey}" must be monitored; found "${input.type}".`,
      );
    }
    const expectedQuantityKind =
      binding.source === "measurement-property"
        ? binding.measurementProperty.quantity_kind
        : binding.quantityKind;
    if (input.quantity_kind !== expectedQuantityKind) {
      throw new SafeError(
        `Sequestration component ${component.id} input "${inputKey}" requires quantity kind "${expectedQuantityKind}"; found "${input.quantity_kind}".`,
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
                `Measurement sample ${submission.supplierRefId} has invalid ${rtcInput.input_key} magnitude ${String(magnitude)}; expected a finite value from ${S_FRACTION_MIN} to ${S_FRACTION_MAX}.`,
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
            `Measurement-sample submissions did not contain a value for direct sequestration component ${component.id} input "${rtcInput.input_key}" ` +
              `(evidence property "${propertyKey}").`,
          );
        }
        if (binding.dataShape === "SCALAR" && directIndex !== 1) {
          throw new SafeError(
            `Sequestration component ${component.id} input "${rtcInput.input_key}" is SCALAR but ${directIndex} direct datapoints were built.`,
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
              `Measurement-sample responses did not return a datapoint for sequestration component ${component.id} input "${rtcInput.input_key}" ` +
                `(measurement property "${propertyKey}").`,
            );
          }
        } else {
          datapointIds = datapointIdsByRtcInput.get(rtcInputKey) ?? [];
          if (datapointIds.length === 0) {
            throw new SafeError(
              `The orchestrator did not post a direct datapoint for sequestration component ${component.id} input "${rtcInput.input_key}" ` +
                `(quantity kind "${binding.quantityKind}", unit "${binding.unit}").`,
            );
          }
        }

        if (binding.dataShape === "SCALAR" && datapointIds.length !== 1) {
          throw new SafeError(
            `Sequestration component ${component.id} input "${rtcInput.input_key}" is SCALAR but ${datapointIds.length} datapoints were resolved.`,
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
  const supported = Object.keys(SEQUESTRATION_COMPONENT_INPUT_BINDINGS)
    .map((key) => `"${key}"`)
    .join(", ");
  throw new SafeError(
    `Sequestration blueprint "${blueprintKey}" has no explicit GHG-entry datapoint binding. ` +
      `Re-author the removal template to a supported blueprint (${supported}), or add and verify its source-to-input mapping before submitting.`,
  );
}

function missingInputBindingError(
  blueprintKey: string,
  inputKey: string,
): SafeError {
  return new SafeError(
    `Sequestration blueprint "${blueprintKey}" input "${inputKey}" has no explicit datapoint-source binding. ` +
      "Update the verified sequestration binding table before submitting.",
  );
}
