import { and, eq, inArray, or } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { documents, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/** Lab evidence belongs to the batch or any of its Samples. Pending uploads never count. */
export async function getBatchesWithLabReports(
  ctx: OrgContext,
  batchIds: string[],
  reader: DbTransaction | typeof db = db,
  loadedSamples?: ReadonlyArray<{ id: string; creditBatchId: string | null }>,
): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (batchIds.length === 0) return new Set();
  const sampleRows = loadedSamples ?? await reader.select({ id: samples.id, creditBatchId: samples.creditBatchId })
    .from(samples).where(and(eq(samples.organizationId, ctx.organizationId), inArray(samples.creditBatchId, batchIds)));
  const sampleBatches = new Map(sampleRows.map((row) => [row.id, row.creditBatchId]));
  const rows = await reader.select({ entityId: documents.entityId, entityType: documents.entityType })
    .from(documents).where(and(
      eq(documents.organizationId, ctx.organizationId),
      eq(documents.uploadStatus, "uploaded"),
      eq(documents.documentType, "lab_report"),
      or(
        and(eq(documents.entityType, "credit_batch"), inArray(documents.entityId, batchIds)),
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

/** Histogram evidence belongs only to a Sample. Pending and failed uploads never count. */
export async function getBatchesWithReflectanceHistograms(
  ctx: OrgContext,
  batchIds: string[],
  reader: DbTransaction | typeof db = db,
): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (batchIds.length === 0) return new Set();
  const rows = await reader.select({ creditBatchId: samples.creditBatchId })
    .from(documents)
    .innerJoin(samples, and(eq(documents.entityId, samples.id), eq(samples.organizationId, ctx.organizationId)))
    .where(and(
      eq(documents.organizationId, ctx.organizationId),
      eq(documents.entityType, "sample"),
      eq(documents.uploadStatus, "uploaded"),
      eq(documents.documentType, "reflectance_histogram"),
      inArray(samples.creditBatchId, batchIds),
    ));
  return new Set(rows.map((row) => row.creditBatchId));
}
