import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { UPLOAD_NOT_PENDING_MESSAGE } from "@/config/documents";
import type { DocumentRow } from "@/data-access/documents";
import type { StorageProvider } from "@/lib/storage/types";
import { DomainError } from "@/lib/domain-errors";
import { metadataRecord } from "./metadata";

export interface RequestUploadResult {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
  storageKey: string;
  metadata: Record<string, unknown>;
}
export async function presignRequestedUpload(
  provider: StorageProvider,
  row: Pick<DocumentRow, "id" | "uploadExpiresAt" | "uploadStorageKey" | "metadata">,
  { contentType, sizeBytes }: { contentType: string; sizeBytes: number },
): Promise<RequestUploadResult> {
  const expiresInSeconds = Math.floor((row.uploadExpiresAt!.getTime() - Date.now()) / MILLISECONDS_PER_SECOND);
  if (expiresInSeconds <= 0) throw new DomainError("conflict", UPLOAD_NOT_PENDING_MESSAGE, { retryable: true });
  const presign = await provider.createUploadUrl({ key: row.uploadStorageKey!, contentType, maxBytes: sizeBytes, expiresInSeconds });
  return { documentId: row.id, uploadUrl: presign.url, headers: presign.headers, expiresAt: row.uploadExpiresAt!.toISOString(),
    storageKey: row.uploadStorageKey!, metadata: metadataRecord(row.metadata) };
}
