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

export async function seedDocuments(ctx: OrgContext, owners: { delivery: string; feedstock: string; lab_sample: string }, options: Pick<RunOptions, "activitySource">) {
  const provider = getStorageProvider();
  if (provider.name !== "local-fs") throw new Error("API fuzz documents require local-fs storage.");
  const bytes = billOfLadingPdf();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fixtures = [];
  for (const ownerType of ["delivery", "feedstock", "lab_sample"] as const) {
    const ownerId = owners[ownerType];
    const declaration = {
      ownerType, ownerId, documentType: ownerType === "lab_sample" ? "lab_report" as const : "bill_of_lading" as const,
      fileName: "fuzz-evidence.pdf", contentType: "application/pdf", sizeBytes: bytes.length, sha256,
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
