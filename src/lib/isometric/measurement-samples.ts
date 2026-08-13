/**
 * Typed wrappers for the Isometric `MeasurementSample` API surface used by the
 * 200-year durability submission path (Phase E). Pure HTTP — no DB, no auth, no
 * ActionResult — mirroring `sensors.ts`. A measurement sample groups datapoints
 * (H/C_org per production batch, soil temperature per project area) under a
 * `MeasurementTypeKey`; the sequestration blueprint inputs then reference those
 * datapoints.
 *
 * The response parser below captures each value's explicit datapoint ID for
 * the GHG-entry binding. Registry POSTs remain sandbox-flagged by the
 * orchestrator; these wrappers are transport only.
 */

import { createHash } from "node:crypto";
import { SafeError } from "@/lib/errors";
import { pluralize } from "@/lib/copy-utils";
import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";
import { encodeMeasurementProperty } from "./utils/measurement-property";

export type IsometricMeasurementSample = components["schemas"]["MeasurementSample"];
export type CreateMeasurementSampleRequest =
  components["schemas"]["CreateMeasurementSampleRequest"];

const ENTITY_PREFIX_LEN = 12;

type MeasurementSampleRole = "production-batch" | "soil";

export interface MeasurementSampleDatapointCapture {
  measurementSampleId: string;
  supplierReferenceId: string | null;
  datapointIdsByMeasurementProperty: Map<string, string[]>;
}

/**
 * Captures the explicit datapoint IDs returned on a measurement-sample
 * response, grouped by its stable `{quantity_kind, qualifier}` property key.
 * Multiple values with the same property (the 1000-year replicate lists) keep
 * response order.
 */
export function captureMeasurementSampleDatapointIds(
  sample: IsometricMeasurementSample,
  request: CreateMeasurementSampleRequest,
): MeasurementSampleDatapointCapture {
  const datapointIdsByMeasurementProperty = new Map<string, string[]>();
  const expectedCountByMeasurementProperty = new Map<string, number>();
  const returnedCountByMeasurementProperty = new Map<string, number>();
  const returnedDatapointIds = new Set<string>();

  for (const value of request.values) {
    const propertyKey = encodeMeasurementProperty(value.measurement_property);
    expectedCountByMeasurementProperty.set(
      propertyKey,
      (expectedCountByMeasurementProperty.get(propertyKey) ?? 0) + 1,
    );
  }

  for (const value of sample.values) {
    if (
      typeof value.datapoint_id !== "string" ||
      value.datapoint_id.length === 0
    ) {
      throw new SafeError(
        `Registry measurement ${sample.id} has a value with no identifier. Ask support to check the registry response.`,
      );
    }
    if (returnedDatapointIds.has(value.datapoint_id)) {
      throw new SafeError(
        `Registry measurement ${sample.id} repeats value ${value.datapoint_id}. Ask support to check the registry response.`,
      );
    }
    returnedDatapointIds.add(value.datapoint_id);

    const propertyKey = encodeMeasurementProperty(value.measurement_property);
    if (!expectedCountByMeasurementProperty.has(propertyKey)) {
      throw new SafeError(
        `Registry measurement ${sample.id} contains a value the Removal template does not use. Ask support to check the registry template.`,
      );
    }
    returnedCountByMeasurementProperty.set(
      propertyKey,
      (returnedCountByMeasurementProperty.get(propertyKey) ?? 0) + 1,
    );
    const existing = datapointIdsByMeasurementProperty.get(propertyKey) ?? [];
    existing.push(value.datapoint_id);
    datapointIdsByMeasurementProperty.set(propertyKey, existing);
  }

  for (const [propertyKey, expectedCount] of expectedCountByMeasurementProperty) {
    const returnedCount =
      returnedCountByMeasurementProperty.get(propertyKey) ?? 0;
    if (returnedCount !== expectedCount) {
      throw new SafeError(
        `Registry measurement ${sample.id} returned ${returnedCount} ${pluralize(returnedCount, "value")} for one durability field, but ${expectedCount} ${expectedCount === 1 ? "is" : "are"} required. Refresh the registry data and try again.`,
      );
    }
  }

  return {
    measurementSampleId: sample.id,
    supplierReferenceId: sample.supplier_reference_id,
    datapointIdsByMeasurementProperty,
  };
}

export function mergeMeasurementSampleDatapointIds(
  captures: MeasurementSampleDatapointCapture[],
): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const capture of captures) {
    for (const [
      propertyKey,
      datapointIds,
    ] of capture.datapointIdsByMeasurementProperty) {
      merged.set(propertyKey, [
        ...(merged.get(propertyKey) ?? []),
        ...datapointIds,
      ]);
    }
  }
  return merged;
}

export interface BuildMeasurementSampleReferenceArgs {
  removalId: string;
  role: MeasurementSampleRole;
  version: number;
  /** Required for the per-batch role — the credit batch id the sample is for. */
  creditBatchId?: string;
  /** Required for production-batch Samples — the stable local Sample identity. */
  sampleId?: string;
}

/**
 * Stable, noma-controlled measurement-sample supplier reference, versioned per
 * removal so a superseded-then-resubmitted removal claims a fresh resource. The
 * production-batch role keys on both the CREDIT BATCH (the protocol production
 * batch, ADR 0016) and the independently analysed local Sample. The `nm-mts-`
 * prefix never collides with the removal
 * (`nm-rmv-`) or sensor (`nm-snr-`) refs. Mirrors `buildRemovalSupplierRef`.
 */
export function buildMeasurementSampleReference(
  args: BuildMeasurementSampleReferenceArgs,
): string {
  const short = shortHash(args.removalId, ENTITY_PREFIX_LEN);
  if (args.role === "soil") {
    return `nm-mts-${short}-soil-v${args.version}`;
  }
  if (!args.creditBatchId) {
    throw new Error(
      "buildMeasurementSampleReference: creditBatchId required for the production-batch role",
    );
  }
  if (!args.sampleId) {
    throw new Error(
      "buildMeasurementSampleReference: sampleId required for the production-batch role",
    );
  }
  const batchShort = shortHash(args.creditBatchId, ENTITY_PREFIX_LEN);
  const sampleShort = shortHash(args.sampleId, ENTITY_PREFIX_LEN);
  return `nm-mts-${short}-pb-${batchShort}-s-${sampleShort}-v${args.version}`;
}

function shortHash(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export async function createMeasurementSample(
  client: IsometricClient,
  body: CreateMeasurementSampleRequest,
): Promise<IsometricMeasurementSample> {
  return client.post<IsometricMeasurementSample>(
    "/measurement_samples",
    body,
  );
}

/**
 * Looks up a measurement sample by its noma-controlled supplier reference for
 * the reconcile path. The `GET /measurement_samples` endpoint exposes no
 * server-side reference filter (unlike `/sensors`), so this paginates and
 * filters client-side. Returns the match or null.
 */
export async function findMeasurementSampleBySupplierRef(
  client: IsometricClient,
  supplierReferenceId: string,
): Promise<IsometricMeasurementSample | null> {
  for await (const sample of client.paginate<IsometricMeasurementSample>(
    "/measurement_samples",
  )) {
    if (sample.supplier_reference_id === supplierReferenceId) return sample;
  }
  return null;
}
