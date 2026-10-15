import { and, eq, inArray, or } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { documents, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

type LoadedSamples = ReadonlyArray<{ id: string; creditBatchId: string | null }>;

async function getBatchesWithSampleDocuments(
  ctx: OrgContext,
  batchIds: string[],
  documentType: "lab_report" | "reflectance_histogram",
  includeCreditBatchOwners: boolean,
  reader: DbTransaction | typeof db,
  loadedSamples?: LoadedSamples,
): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (batchIds.length === 0) return new Set();
  const sampleRows = loadedSamples ?? await reader.select({ id: samples.id, creditBatchId: samples.creditBatchId })
    .from(samples).where(and(eq(samples.organizationId, ctx.organizationId), inArray(samples.creditBatchId, batchIds)));
  if (!includeCreditBatchOwners && sampleRows.length === 0) return new Set();
  const sampleBatches = new Map(sampleRows.map((row) => [row.id, row.creditBatchId]));
  const rows = await reader.select({ entityId: documents.entityId, entityType: documents.entityType })
    .from(documents).where(and(
      eq(documents.organizationId, ctx.organizationId),
      eq(documents.uploadStatus, "uploaded"),
      eq(documents.documentType, documentType),
      or(
        includeCreditBatchOwners
          ? and(eq(documents.entityType, "credit_batch"), inArray(documents.entityId, batchIds))
          : undefined,
        sampleRows.length > 0
          ? and(eq(documents.entityType, "sample"), inArray(documents.entityId, sampleRows.map((row) => row.id)))
          : undefined,
      ),
    ));
  return new Set(rows.flatMap((row) => {
    const batchId = row.entityType === "credit_batch" ? row.entityId : sampleBatches.get(row.entityId);
    return batchId ? [batchId] : [];
  }));
}

/** Lab evidence belongs to the batch or any of its Samples. Pending uploads never count. */
export async function getBatchesWithLabReports(
  ctx: OrgContext,
  batchIds: string[],
  reader: DbTransaction | typeof db = db,
  loadedSamples?: LoadedSamples,
): Promise<Set<string>> {
  return getBatchesWithSampleDocuments(ctx, batchIds, "lab_report", true, reader, loadedSamples);
}

/** Histogram evidence belongs only to a Sample. Pending and failed uploads never count. */
export async function getBatchesWithReflectanceHistograms(
  ctx: OrgContext,
  batchIds: string[],
  reader: DbTransaction | typeof db = db,
  loadedSamples?: LoadedSamples,
): Promise<Set<string>> {
  return getBatchesWithSampleDocuments(ctx, batchIds, "reflectance_histogram", false, reader, loadedSamples);
}
