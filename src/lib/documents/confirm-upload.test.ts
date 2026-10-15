import { beforeEach, expect, it, vi } from "vitest";
import type { DocumentRow } from "@/data-access/documents";
import { DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), run: vi.fn() }));
vi.mock("@/data-access/documents", () => ({ getDocumentById: mocks.read }));
vi.mock("./upload-preparation", () => ({ preparePendingDocumentUpload: mocks.prepare }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
import { confirmDocumentUpload } from "./confirm-upload";
import { mapConfirmOutcome } from "./confirm-outcome";
import { representDocument } from "@/lib/representations/documents";
const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const documentId = "12345678-1234-4234-8234-123456789abc";
const ownerId = "22345678-1234-4234-8234-123456789abc";
const row = { id: documentId, entityId: ownerId, entityType: "delivery", documentType: "delivery_receipt", uploadStatus: "pending", fileName: "report.pdf", mimeType: "application/pdf", fileSizeBytes: 8, checksumSha256: null, description: null, version: 1, createdAt: new Date(), updatedAt: new Date(), metadata: {} } as DocumentRow;
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(row); });
it.each(["uploaded", "gone", "failed"] as const)("maps a terminal %s preparation without running or auditing another operation", async (kind) => {
  const terminal = kind === "uploaded" ? { kind, document: { ...row, uploadStatus: "uploaded" as const, version: 2 } }
    : kind === "failed" ? { kind, reason: "expired", message: "This upload expired." } : { kind };
  mocks.prepare.mockResolvedValue(terminal);
  const result = await confirmDocumentUpload(ctx, { ownerType: "delivery", ownerId, documentId }, { deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS });
  expect(mapConfirmOutcome(result).status).toBe(kind === "uploaded" ? 200 : kind === "gone" ? 404 : 409);
  if (terminal.kind === "uploaded") expect(result).toEqual({ kind, document: representDocument(terminal.document) });
  expect(mocks.run).not.toHaveBeenCalled();
});
