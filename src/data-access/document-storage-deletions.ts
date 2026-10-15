import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { DOCUMENT_UPLOAD_GRACE_MS } from "@/config/documents";
import { isUploadKey } from "@/lib/storage/keys";
import type { DocumentRow } from "./documents";
import { enqueueStorageObjectDeletion } from "./storage-object-deletions";
import { requireOrgScope } from "./utils";
export async function enqueueDocumentKeys(ctx: OrgContext, tx: DbTransaction, document: DocumentRow): Promise<void> {
  requireOrgScope(ctx);
  const keys = [...new Set([document.storageKey, document.uploadStorageKey].filter((key): key is string => !!key))].sort();
  for (const storageKey of keys) {
    if (!document.storageProvider || !document.storageBucket) throw new Error("Stored document is missing its provider or bucket");
    await enqueueStorageObjectDeletion(ctx, tx, { storageProvider: document.storageProvider, storageBucket: document.storageBucket, storageKey,
      notBefore: isUploadKey(storageKey) && document.uploadExpiresAt ? new Date(document.uploadExpiresAt.getTime() + DOCUMENT_UPLOAD_GRACE_MS) : undefined });
  }
}
