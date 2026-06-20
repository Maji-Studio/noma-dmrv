import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import { SafeError } from "@/lib/errors";
import type { FacilityReferenceSoilTemperature } from "@/lib/isometric/utils/durability-aggregation";
import { z } from "zod";
import {
  buildDurabilityMeasurementSampleSubmissions,
  type DurabilityMeasurementSampleSubmission,
} from "./durability-measurement-samples";

export interface DurabilityMeasurementSampleClaimArgs {
  removalId: string;
  externalProjectId: string;
  batches: CreditBatchWithSamples[];
  attributionByRunId: Map<string, number>;
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature;
  measuredAt: string;
}

interface SemanticMeasurementSample {
  operationKey: string;
  label: string;
  body: Record<string, unknown>;
}

const NORMALIZED_MEASUREMENT_SAMPLE_SUPPLIER_REF =
  "__versioned_measurement_sample_supplier_ref__";

const measurementSampleSnapshotEntrySchema = z.object({
  operationKey: z.string().min(1),
  supplierRefId: z.string().min(1),
  label: z.string().min(1),
  body: z
    .object({
      supplier_reference_id: z.string().min(1),
    })
    .passthrough(),
});
const durabilityMeasurementSamplesSnapshotSchema = z.object({
  submissions: z.array(measurementSampleSnapshotEntrySchema),
});

function sortMeasurementSampleSubmissions(
  submissions: DurabilityMeasurementSampleSubmission[],
): DurabilityMeasurementSampleSubmission[] {
  return [...submissions].sort((a, b) =>
    a.operationKey.localeCompare(b.operationKey),
  );
}

export function buildVersionedMeasurementSampleSubmissions(
  args: DurabilityMeasurementSampleClaimArgs & { version: number },
): DurabilityMeasurementSampleSubmission[] {
  return sortMeasurementSampleSubmissions(
    buildDurabilityMeasurementSampleSubmissions(args),
  );
}

export function normalizeMeasurementSamplesForHash(
  submissions: DurabilityMeasurementSampleSubmission[],
): SemanticMeasurementSample[] {
  return sortMeasurementSampleSubmissions(submissions).map((submission) => ({
    operationKey: submission.operationKey,
    label: submission.label,
    body: {
      ...submission.body,
      supplier_reference_id: NORMALIZED_MEASUREMENT_SAMPLE_SUPPLIER_REF,
    },
  }));
}

export function readRemovalDurabilityMeasurementSamples(
  row: CertificationSubmissionRow,
): DurabilityMeasurementSampleSubmission[] {
  const snapshot = row.payloadSnapshot as {
    durabilityMeasurementSamples?: unknown;
  } | null;
  const parsed = durabilityMeasurementSamplesSnapshotSchema.safeParse(
    snapshot?.durabilityMeasurementSamples,
  );
  if (!parsed.success) {
    throw new SafeError(
      "Stale submission cannot be resumed because its durability measurement-sample snapshot does not match the current payload schema.",
    );
  }
  return parsed.data.submissions as DurabilityMeasurementSampleSubmission[];
}
