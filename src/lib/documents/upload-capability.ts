import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import type { OrgContext } from "@/lib/auth/server";
import type { UploadUnavailableReason } from "@/data-access/document-upload-renewal";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";
import { renewDocumentUpload } from "@/lib/operations/document-upload-renewal";
import { runOperation, type RunOptions } from "@/lib/operations/runner";
import { getStorageProvider } from "@/lib/storage";


export const UPLOAD_UNAVAILABLE_WARNINGS: Record<UploadUnavailableReason, string> = {
  uploaded: "This file is already uploaded, so no upload link is needed.",
  failed: "This upload failed. Request a new upload to try again.",
  deleted: "This document was deleted, so no upload link is available.",
  expired: "This upload expired. Request a new upload to try again.",
  owner_archived: "This record, its facility or its credit batch is archived, so its files cannot change.",
  certification_locked: RECORD_FILES_LOCKED_MESSAGE,
};
export type DocumentUploadCapability = {
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
  warning?: never;
} | { upload: null; warning: string };

/** Call after both a committed request and its historical replay, outside idempotency. */
export async function mintDocumentUploadCapability(ctx: OrgContext, documentId: string, options: Pick<RunOptions, "pool" | "deadlineMs"> = {}): Promise<DocumentUploadCapability> {
  const { data: lease } = await runOperation(renewDocumentUpload, ctx, { documentId }, { pool: options.pool, deadlineMs: options.deadlineMs });
  if (lease.kind === "unavailable") return { upload: null, warning: UPLOAD_UNAVAILABLE_WARNINGS[lease.reason] };
  // Round down: a PUT capability must never extend past its persisted lease.
  const signingDate = new Date(Date.now());
  const expiresInSeconds = Math.floor((new Date(lease.expiresAt).getTime() - signingDate.getTime()) / MILLISECONDS_PER_SECOND);
  if (expiresInSeconds <= 0) return { upload: null, warning: UPLOAD_UNAVAILABLE_WARNINGS.expired };
  const provider = getStorageProvider();
  if (provider.name !== lease.provider || provider.bucket !== lease.bucket) throw new Error("Storage configuration does not match document");
  const signed = await provider.createUploadUrl({ key: lease.key, contentType: lease.contentType, maxBytes: lease.sizeBytes, expiresInSeconds, signingDate });
  return { upload: { url: signed.url, method: "PUT", headers: { "Content-Type": lease.contentType }, expiresAt: lease.expiresAt } };
}
