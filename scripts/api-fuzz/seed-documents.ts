import { createHash } from "node:crypto";
import type { OrgContext } from "@/lib/auth/server";
import { DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import { requestDocumentUpload } from "@/lib/operations/document-uploads";
import { runOperation, type RunOptions } from "@/lib/operations/runner";
import { confirmDocumentUpload } from "@/lib/documents/confirm-upload";
import { getDocumentById } from "@/data-access/documents";
import { documentEtag } from "@/lib/api/representation-etags";
import { getStorageProvider } from "@/lib/storage";
import { billOfLadingPdf } from "../eval-mcp/fixture-document-file";

// A complete one-pixel PNG for the application photo fixture.
const APPLICATION_PHOTO_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

export async function seedDocuments(ctx: OrgContext, owners: { delivery: string; feedstock: string; lab_sample: string; application: string }, options: Pick<RunOptions, "activitySource">) {
  const provider = getStorageProvider();
  if (provider.name !== "local-fs") throw new Error("API fuzz documents require local-fs storage.");
  const pdf = billOfLadingPdf();
  const photo = Buffer.from(APPLICATION_PHOTO_BASE64, "base64");
  const fixtures = [];
  for (const ownerType of ["delivery", "feedstock", "lab_sample", "application"] as const) {
    const ownerId = owners[ownerType];
    const isPhoto = ownerType === "application";
    const bytes = isPhoto ? photo : pdf;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const declaration = {
      ownerType, ownerId, documentType: isPhoto ? "photo" as const : ownerType === "lab_sample" ? "lab_report" as const : "bill_of_lading" as const,
      fileName: isPhoto ? "fuzz-evidence.png" : "fuzz-evidence.pdf", contentType: isPhoto ? "image/png" : "application/pdf", sizeBytes: bytes.length, sha256,
    };
    const requested = (await runOperation(requestDocumentUpload, ctx, declaration, options)).data;
    const row = await getDocumentById(ctx, requested.id);
    if (!row?.uploadStorageKey) throw new Error("Fuzz upload has no upload key.");
    await provider.putObject(row.uploadStorageKey, bytes, declaration.contentType);
    const confirmed = await confirmDocumentUpload(ctx, { ownerType, ownerId, documentId: row.id }, {
      ...options, deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS,
    });
    if (confirmed.kind !== "uploaded") throw new Error("Fuzz document confirmation failed.");
    const pending = (await runOperation(requestDocumentUpload, ctx, declaration, options)).data;
    fixtures.push({
      ownerType, ownerId, documentType: declaration.documentType,
      uploaded: { id: confirmed.document.id, etag: documentEtag(confirmed.document), physicalObject: true },
      pending: { id: pending.id, etag: documentEtag(pending), data: pending },
    });
  }
  return fixtures;
}
