import { z } from "zod";
import { SafeError } from "@/lib/errors";
import { buildMeasurementSampleReference } from "@/lib/isometric/measurement-samples";
import { readJournaledMeasurementSamples } from "./measurement-sample-journal";

const snapshotSchema = z.object({
  durabilityMeasurementSamples: z.object({ submissions: z.array(z.object({
    creditBatchId: z.string().min(1), sampleId: z.string().min(1),
    supplierRefId: z.string().min(1),
    body: z.object({ supplier_reference_id: z.string().min(1) }).passthrough(),
  })) }).optional(),
}).passthrough();

export interface RemovalOwnedMeasurement {
  submissionId: string;
  supplierReference: string;
  externalId: string | null;
}

export function removalOwnedMeasurements(removalId: string, rows: Array<{
  id: string; version: number; payloadSnapshot: unknown; metadata: unknown;
}>): RemovalOwnedMeasurement[] {
  const result: RemovalOwnedMeasurement[] = [];
  const ids = new Set<string>();
  const references = new Set<string>();
  for (const row of rows) {
    const parsed = snapshotSchema.safeParse(row.payloadSnapshot ?? {});
    if (!parsed.success) throw damaged();
    const journal = readJournaledMeasurementSamples(row.payloadSnapshot);
    const metadata = row.metadata as { measurementSamples?: unknown } | null;
    const metadataJournal = readJournaledMeasurementSamples({ journaled: {
      ...(metadata?.measurementSamples === undefined ? {} : { measurementSamples: metadata.measurementSamples }),
    } });
    for (const entry of metadataJournal) {
      const existing = journal.find((item) => item.supplierReferenceId === entry.supplierReferenceId);
      if (existing && existing.measurementSampleId !== entry.measurementSampleId) throw damaged();
      if (!existing) journal.push(entry);
    }
    const submissions = parsed.data.durabilityMeasurementSamples?.submissions ?? [];
    for (const sample of submissions) {
      const reference = buildMeasurementSampleReference({ removalId, version: row.version,
        role: "production-batch", creditBatchId: sample.creditBatchId, sampleId: sample.sampleId });
      if (sample.supplierRefId !== reference || sample.body.supplier_reference_id !== reference || references.has(reference)) throw damaged();
      references.add(reference);
      const entry = journal.find((item) => item.supplierReferenceId === reference);
      if (entry && ids.has(entry.measurementSampleId)) throw damaged();
      if (entry) ids.add(entry.measurementSampleId);
      result.push({ submissionId: row.id, supplierReference: reference, externalId: entry?.measurementSampleId ?? null });
    }
    if (journal.some((entry) => !submissions.some((sample) => sample.supplierRefId === entry.supplierReferenceId))) throw damaged();
  }
  return result;
}

function damaged(): SafeError {
  return new SafeError("The saved Removal measurements have inconsistent ownership. Ask support to check them before deleting the Removal.");
}
