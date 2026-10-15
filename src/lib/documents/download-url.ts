import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { DOCUMENT_DOWNLOAD_TTL_SECONDS } from "@/config/documents";
import type { ApiContext } from "@/lib/auth/api-context";
import { documentNotFound, readApiDocument } from "@/lib/read-models/api-documents";
import { getStorageProvider } from "@/lib/storage";
import type { ApiDocumentOwnerType } from "./api-owners";

export async function documentDownloadUrl(ctx: ApiContext, ownerType: ApiDocumentOwnerType, ownerId: string, documentId: string) {
  const row = await readApiDocument(ctx, ownerType, ownerId, documentId);
  // Legacy URLs cannot guarantee an expiring capability.
  if (row.uploadStatus !== "uploaded" || !row.storageKey) throw documentNotFound();
  const expiresAt = new Date(Date.now() + DOCUMENT_DOWNLOAD_TTL_SECONDS * MILLISECONDS_PER_SECOND).toISOString();
  const url = await getStorageProvider().createDownloadUrl({ key: row.storageKey, expiresInSeconds: DOCUMENT_DOWNLOAD_TTL_SECONDS });
  return { url, expiresAt };
}
