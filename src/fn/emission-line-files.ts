"use server";

import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { UPLOAD_NOT_PENDING_MESSAGE } from "@/config/documents";
import { attachEmissionLineFile, removeEmissionLineFile } from "@/data-access/emission-line-files";
import { getStorageProvider } from "@/lib/storage";
import { DomainError } from "@/lib/domain-errors";
import { metadataRecord } from "@/lib/documents/metadata";
import { attachEmissionLineFileSchema, removeEmissionLineFileSchema } from "@/schemas/emission-line-files";
import type { ActionResult } from "@/types/actions";
import type { RequestUploadResult } from "./documents";
import { withAction } from "./with-action";

export async function attachEmissionLineFileFn(input: unknown): Promise<ActionResult<RequestUploadResult>> {
  return withAction(async ctx => {
    const data = attachEmissionLineFileSchema.parse(input);
    const provider = getStorageProvider();
    const row = await attachEmissionLineFile(ctx, data, { storageProvider: provider.name, storageBucket: provider.bucket });
    const expiresInSeconds = Math.floor((row.uploadExpiresAt!.getTime() - Date.now()) / MILLISECONDS_PER_SECOND);
    if (expiresInSeconds <= 0) throw new DomainError("conflict", UPLOAD_NOT_PENDING_MESSAGE, { retryable: true });
    const presign = await provider.createUploadUrl({ key: row.uploadStorageKey!, contentType: data.upload.contentType, maxBytes: data.upload.sizeBytes, expiresInSeconds });
    return { documentId: row.id, uploadUrl: presign.url, headers: presign.headers, expiresAt: row.uploadExpiresAt!.toISOString(), storageKey: row.uploadStorageKey!, metadata: metadataRecord(row.metadata) };
  });
}

export async function removeEmissionLineFileFn(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withAction(ctx => removeEmissionLineFile(ctx, removeEmissionLineFileSchema.parse(input)));
}
