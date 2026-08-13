import { encodeMeasurementProperty } from "@/lib/isometric/utils/measurement-property";
import type {
  RemovalTemplateDiagnosticInput,
  RemovalTemplateDiagnosticModel,
  RemovalTemplateResolvedValues,
} from "./removal-template-diagnostic";

export interface RemovalTemplateDiagnosticCompilation {
  review: {
    bindings: Array<{
      componentId: string;
      inputKey: string;
      binding: "monitored" | "fixed" | "measurement-sample";
      wireMagnitude?: number;
      wireUnit?: string;
    }>;
    measurementSamples: Array<{ values: unknown[] }>;
    directSequestrationDatapoints: Array<{
      componentId: string;
      inputKey: string;
      magnitude: number;
      unit: string;
    }>;
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function measurementValues(
  compilation: RemovalTemplateDiagnosticCompilation,
  property: { quantity_kind: string; qualifier: string | null },
): RemovalTemplateResolvedValues {
  const expectedKey = encodeMeasurementProperty(property as never);
  const magnitudes: number[] = [];
  let unit: string | null = null;
  for (const sample of compilation.review.measurementSamples) {
    for (const rawValue of sample.values) {
      const value = recordValue(rawValue);
      const measurementProperty = recordValue(value?.measurement_property);
      const quantity = recordValue(value?.value);
      if (!measurementProperty || !quantity) continue;
      if (
        encodeMeasurementProperty(measurementProperty as never) !== expectedKey
      ) {
        continue;
      }
      if (typeof quantity.magnitude === "number") {
        magnitudes.push(quantity.magnitude);
      }
      if (unit === null && typeof quantity.unit === "string") unit = quantity.unit;
    }
  }
  return {
    binding: "measurement-sample",
    count: magnitudes.length,
    magnitudes,
    unit,
  };
}

function resolveInput(
  input: RemovalTemplateDiagnosticInput,
  compilation: RemovalTemplateDiagnosticCompilation,
): RemovalTemplateResolvedValues | null {
  if (!input.presentInTemplate) return null;
  if (input.resolutionContract.kind === "measurement-property") {
    return measurementValues(compilation, input.resolutionContract.property);
  }
  if (input.resolutionContract.kind === "direct-datapoint") {
    const datapoints =
      compilation.review.directSequestrationDatapoints.filter(
        (datapoint) =>
          datapoint.componentId === input.raw.componentId &&
          datapoint.inputKey === input.inputKey,
      );
    return {
      binding: "datapoint",
      count: datapoints.length,
      magnitudes: datapoints.map((datapoint) => datapoint.magnitude),
      unit: datapoints[0]?.unit ?? null,
    };
  }

  const binding = compilation.review.bindings.find(
    (candidate) =>
      candidate.componentId === input.raw.componentId &&
      candidate.inputKey === input.inputKey,
  );
  if (!binding) return null;
  return {
    binding: binding.binding === "fixed" ? "fixed" : "datapoint",
    count:
      binding.binding === "fixed" || binding.wireMagnitude !== undefined
        ? 1
        : 0,
    magnitudes:
      binding.wireMagnitude === undefined ? [] : [binding.wireMagnitude],
    unit: binding.wireUnit ?? null,
  };
}

/** Adds one read-only compilation trace to the existing normalized rows. */
export function attachRemovalCompilationToDiagnostic(
  model: RemovalTemplateDiagnosticModel,
  compilation: RemovalTemplateDiagnosticCompilation,
): RemovalTemplateDiagnosticModel {
  return {
    ...model,
    groups: model.groups.map((group) => ({
      ...group,
      components: group.components.map((component) => ({
        ...component,
        inputs: component.inputs.map((input) => ({
          ...input,
          resolved: resolveInput(input, compilation),
        })),
      })),
    })),
  };
}
