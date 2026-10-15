import { nextVersion } from "./row-version";
import { and, asc, eq, exists, inArray, isNull, lt, or } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { documents, storageObjectDeletions } from "@/db/schema";
import { DOCUMENT_FAILED_RETENTION_MS, DOCUMENT_SWEEP_BATCH_SIZE, DOCUMENT_SWEEP_BUDGET_MS, DOCUMENT_UPLOAD_GRACE_MS } from "@/config/documents";
import { pgErrorCode } from "@/db/errors";
import { logger } from "@/lib/log";
import type { OrgContext } from "@/lib/auth/server";
import { metadataRecord } from "@/lib/documents/metadata";
import { enqueueDocumentKeys, enqueuePromotionCandidates } from "./document-storage-deletions";
import { deleteDocumentRow } from "./documents";

// org-scope-ok: cron sweep derives the scope only from locked database rows, never request input.
function sweepContext(organizationId: string): OrgContext {
  return { organizationId, userId: "cron-sweep", orgRole: null, isPlatformAdmin: false };
}

/** No owner/artifact locks: expiry changes only pending uploads, never retained evidence. */
export async function expireDocumentUploadsInTransaction(tx: DbTransaction, now: Date, organizationIds?: string[]): Promise<number> {
  // org-scope-ok: cron sweep must find abandoned uploads across all organizations.
  const rows = await tx.select().from(documents).where(and(
    eq(documents.uploadStatus, "pending"),
    organizationIds ? inArray(documents.organizationId, organizationIds) : undefined,
    lt(documents.uploadExpiresAt, new Date(now.getTime() - DOCUMENT_UPLOAD_GRACE_MS)),
  )).orderBy(asc(documents.uploadExpiresAt), asc(documents.id))
    .limit(DOCUMENT_SWEEP_BATCH_SIZE).for("update", { skipLocked: true });
  for (const row of rows) {
    const ctx = sweepContext(row.organizationId);
    await enqueueDocumentKeys(ctx, tx, row);
    // org-scope-ok: cron sweep mutates only the organization of this locked expired row.
    await tx.update(documents).set({
      uploadStatus: "failed", version: nextVersion(documents.version), updatedAt: now,
      metadata: { ...metadataRecord(row.metadata), uploadFailure: { reason: "expired" } },
    }).where(and(eq(documents.id, row.id), eq(documents.organizationId, row.organizationId)));
  }
  return rows.length;
}

export async function retireFailedDocumentUploadsInTransaction(tx: DbTransaction, now: Date, organizationIds?: string[]): Promise<number> {
  // Completed queue entries count too: the durable hand-off already happened.
  const queued = (key: typeof documents.storageKey | typeof documents.uploadStorageKey) => exists(tx.select({ id: storageObjectDeletions.id })
    .from(storageObjectDeletions).where(and(
      eq(storageObjectDeletions.organizationId, documents.organizationId),
      eq(storageObjectDeletions.storageProvider, documents.storageProvider),
      eq(storageObjectDeletions.storageBucket, documents.storageBucket),
      eq(storageObjectDeletions.storageKey, key),
    )));
  // org-scope-ok: cron sweep retires only failed rows whose every object is already queued.
  const rows = await tx.select().from(documents).where(and(
    eq(documents.uploadStatus, "failed"),
    organizationIds ? inArray(documents.organizationId, organizationIds) : undefined,
    lt(documents.updatedAt, new Date(now.getTime() - DOCUMENT_FAILED_RETENTION_MS)),
    queued(documents.storageKey),
    or(isNull(documents.uploadStorageKey), queued(documents.uploadStorageKey)),
  )).orderBy(asc(documents.updatedAt), asc(documents.id))
    .limit(DOCUMENT_SWEEP_BATCH_SIZE).for("update", { skipLocked: true });
  for (const row of rows) {
    await enqueuePromotionCandidates(sweepContext(row.organizationId), tx, row);
    // Do not acquire owner locks after the document lock.
    // org-scope-ok: cron sweep uses the locked row organization and the existing scoped delete helper.
    await deleteDocumentRow(sweepContext(row.organizationId), row.id, tx);
  }
  return rows.length;
}

export async function sweepDocumentUploads(now = new Date(), organizationIds?: string[]) {
  const deadlineAt = Date.now() + DOCUMENT_SWEEP_BUDGET_MS;
  const counts = { expired: 0, retired: 0 };
  const failedPhases: string[] = [];
  for (const [phase, batch] of [
    ["expired", expireDocumentUploadsInTransaction],
    ["retired", retireFailedDocumentUploadsInTransaction],
  ] as const) {
    try {
      while (Date.now() < deadlineAt) {
        const processed = await db.transaction((tx) => batch(tx, now, organizationIds));
        counts[phase] += processed;
        if (processed < DOCUMENT_SWEEP_BATCH_SIZE) break;
      }
    } catch (error) {
      failedPhases.push(phase);
      logger.error({ phase, ...counts, pgErrorCode: pgErrorCode(error), errorName: error instanceof TypeError ? "TypeError" : error instanceof Error ? "Error" : "Unknown" }, "Document upload sweep phase failed");
    }
  }
  return { ...counts, failedPhases };
}
