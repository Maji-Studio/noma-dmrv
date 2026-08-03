import { and, asc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { storageObjectDeletions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import { getStorageProvider } from "@/lib/storage";
import { requireOrgScope } from "./utils";

const DELETION_BATCH_SIZE = 50;
const DELETION_RETRY_BACKOFF_MS = 60_000;
const STORAGE_DELETE_FAILED = "storage_delete_failed";
const STORAGE_CONFIGURATION_MISMATCH = "storage_configuration_mismatch";
const log = logger.child({ mod: "storage-object-deletions" });

interface StorageObjectRef {
  storageProvider: string;
  storageBucket: string;
  storageKey: string;
}

export interface StorageDeletionRunResult {
  completed: number;
  failed: number;
}

/** Enqueue irreversible cleanup in the same transaction that removes its row. */
export async function enqueueStorageObjectDeletion(
  ctx: OrgContext,
  tx: DbTransaction,
  object: StorageObjectRef,
): Promise<void> {
  requireOrgScope(ctx);
  await tx.insert(storageObjectDeletions).values({
    organizationId: ctx.organizationId,
    ...object,
  });
}

async function processStorageObjectDeletion(
  ctx: OrgContext,
  id: string,
): Promise<"completed" | "failed" | "skipped"> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(storageObjectDeletions)
      .where(
        and(
          eq(storageObjectDeletions.id, id),
          eq(storageObjectDeletions.organizationId, ctx.organizationId),
          isNull(storageObjectDeletions.completedAt),
        ),
      )
      .for("update", { skipLocked: true });
    if (!entry) return "skipped";

    const provider = getStorageProvider();
    const attemptedAt = new Date();
    const attemptPatch = {
      attemptCount: sql`${storageObjectDeletions.attemptCount} + 1`,
      lastAttemptAt: attemptedAt,
      updatedAt: attemptedAt,
    };

    if (
      entry.storageProvider !== provider.name ||
      entry.storageBucket !== provider.bucket
    ) {
      await tx
        .update(storageObjectDeletions)
        .set({
          ...attemptPatch,
          lastErrorCode: STORAGE_CONFIGURATION_MISMATCH,
        })
        .where(
          and(
            eq(storageObjectDeletions.id, id),
            eq(storageObjectDeletions.organizationId, ctx.organizationId),
          ),
        );
      log.error(
        { deletionId: id, organizationId: ctx.organizationId },
        "storage deletion provider configuration does not match queued object",
      );
      return "failed";
    }

    try {
      // Provider deletion is idempotent. If the database update below rolls
      // back, a retry safely deletes the already-absent object again.
      await provider.deleteObject(entry.storageKey);
    } catch {
      await tx
        .update(storageObjectDeletions)
        .set({ ...attemptPatch, lastErrorCode: STORAGE_DELETE_FAILED })
        .where(
          and(
            eq(storageObjectDeletions.id, id),
            eq(storageObjectDeletions.organizationId, ctx.organizationId),
          ),
        );
      log.error(
        { deletionId: id, organizationId: ctx.organizationId },
        "storage object deletion failed and remains pending",
      );
      return "failed";
    }

    await tx
      .update(storageObjectDeletions)
      .set({
        ...attemptPatch,
        lastErrorCode: null,
        completedAt: attemptedAt,
      })
      .where(
        and(
          eq(storageObjectDeletions.id, id),
          eq(storageObjectDeletions.organizationId, ctx.organizationId),
        ),
      );
    return "completed";
  });
}

/**
 * Best-effort organization-scoped drain. Call only after the outer mutation
 * transaction resolves, so storage is never touched before database commit.
 */
export async function processPendingStorageObjectDeletions(
  ctx: OrgContext,
): Promise<StorageDeletionRunResult> {
  requireOrgScope(ctx);
  try {
    const provider = getStorageProvider();
    const mismatchUpdatedAt = new Date();
    const mismatches = await db
      .update(storageObjectDeletions)
      .set({
        lastErrorCode: STORAGE_CONFIGURATION_MISMATCH,
        updatedAt: mismatchUpdatedAt,
      })
      .where(
        and(
          eq(storageObjectDeletions.organizationId, ctx.organizationId),
          isNull(storageObjectDeletions.completedAt),
          or(
            ne(storageObjectDeletions.storageProvider, provider.name),
            ne(storageObjectDeletions.storageBucket, provider.bucket),
          ),
          or(
            isNull(storageObjectDeletions.lastErrorCode),
            ne(
              storageObjectDeletions.lastErrorCode,
              STORAGE_CONFIGURATION_MISMATCH,
            ),
          ),
        ),
      )
      .returning({ id: storageObjectDeletions.id });
    if (mismatches.length > 0) {
      log.error(
        {
          organizationId: ctx.organizationId,
          mismatchCount: mismatches.length,
        },
        "storage deletion provider configuration does not match queued objects",
      );
    }

    const retryBefore = new Date(Date.now() - DELETION_RETRY_BACKOFF_MS);
    const entries = await db
      .select({ id: storageObjectDeletions.id })
      .from(storageObjectDeletions)
      .where(
        and(
          eq(storageObjectDeletions.organizationId, ctx.organizationId),
          isNull(storageObjectDeletions.completedAt),
          eq(storageObjectDeletions.storageProvider, provider.name),
          eq(storageObjectDeletions.storageBucket, provider.bucket),
          or(
            isNull(storageObjectDeletions.lastAttemptAt),
            lte(storageObjectDeletions.lastAttemptAt, retryBefore),
          ),
        ),
      )
      .orderBy(
        sql`${storageObjectDeletions.lastAttemptAt} asc nulls first`,
        asc(storageObjectDeletions.createdAt),
      )
      .limit(DELETION_BATCH_SIZE);

    const result: StorageDeletionRunResult = {
      completed: 0,
      failed: mismatches.length,
    };
    for (const entry of entries) {
      const outcome = await processStorageObjectDeletion(ctx, entry.id);
      if (outcome === "completed") result.completed += 1;
      if (outcome === "failed") result.failed += 1;
    }
    return result;
  } catch {
    log.error(
      { organizationId: ctx.organizationId },
      "storage deletion outbox drain failed; pending entries remain retryable",
    );
    return { completed: 0, failed: 1 };
  }
}
