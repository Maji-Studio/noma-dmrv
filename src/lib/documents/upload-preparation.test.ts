import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import { createHash } from "node:crypto";
import type { DocumentRow } from "@/data-access/documents";
import type { StorageProvider } from "@/lib/storage/types";
const mocks = vi.hoisted(() => ({ read: vi.fn(), owner: vi.fn(), candidate: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/documents", () => ({ getDocumentById: mocks.read }));
vi.mock("@/data-access/document-upload-preparation", () => ({ inspectUploadOwner: mocks.owner, recordDocumentPromotionCandidate: mocks.candidate }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: async () => ({ organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false }) }));
import { prepareDocumentUpload, preparePendingDocumentUpload } from "./upload-preparation";
import { documentFromConfirmOutcome, REFUSAL_MESSAGES, REFUSAL_POINTERS } from "./confirm-outcome";
import { withAction } from "@/fn/with-action";
const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const fileName = "private-evidence-name.pdf";
const signedUrl = "https://storage.example.test/private?X-Amz-Signature=do-not-log";
const bytes = Buffer.from("%PDF-1.7");
const row = { id: "doc", entityType: "facility", entityId: "facility", documentType: "pdf", fileName,
  uploadStatus: "pending", uploadStorageKey: "org/org/uploads/doc/key", storageProvider: "local-fs", storageBucket: "local",
  metadata: { uploadDeclaration: { sizeBytes: bytes.length, contentType: "application/pdf", sha256: null } },
} as DocumentRow;
beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockResolvedValue(false); });
afterEach(() => vi.restoreAllMocks());
it("keeps filenames and signed URLs out of refused-confirm and storage-error logs", async () => {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  const readObjectBounded = vi.fn().mockResolvedValue({ bytes: Buffer.from("not-a-pdf"), sizeBytes: bytes.length, sha256: "unused", contentType: "application/pdf" });
  const provider = { name: "local-fs", bucket: "local", readObjectBounded } as unknown as StorageProvider;
  const refused = await withAction(async () => {
    const { facts } = await preparePendingDocumentUpload(ctx, row, provider, Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS);
    if (!facts.refusal || facts.refusal === "certification_locked") throw new Error("Expected byte refusal");
    return documentFromConfirmOutcome({ kind: "refused", reason: facts.refusal, message: REFUSAL_MESSAGES[facts.refusal], pointer: REFUSAL_POINTERS[facts.refusal], document: row });
  });
  expect(refused).toMatchObject({ success: false, code: "validation_failed" });
  readObjectBounded.mockRejectedValue(new Error(`Storage failed: ${fileName} ${signedUrl}`));
  expect(await withAction(() => preparePendingDocumentUpload(ctx, row, provider, Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS))).toMatchObject({ success: false });
  expect(stderr).toHaveBeenCalled();
  const output = JSON.stringify([...stderr.mock.calls, ...stdout.mock.calls]);
  expect(output).not.toContain(fileName);
  expect(output).not.toContain(signedUrl);
  expect(output).not.toContain("X-Amz-Signature");
});
it("commits a promotion candidate before starting PUT", async () => {
  const putObject = vi.fn(async () => { expect(mocks.candidate).toHaveBeenCalledOnce(); });
  const provider = { name: "local-fs", bucket: "local", putObject, readObjectBounded: async () => ({ bytes, sizeBytes: bytes.length, contentType: "application/pdf", sha256: createHash("sha256").update(bytes).digest("hex") }) } as unknown as StorageProvider;
  const { facts } = await preparePendingDocumentUpload(ctx, row, provider, Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS);
  expect(mocks.candidate).toHaveBeenCalledWith(ctx, row.id, row.uploadStorageKey, facts.finalKey);
  expect(putObject).toHaveBeenCalledOnce();
  mocks.candidate.mockRejectedValueOnce(new Error("database unavailable"));
  putObject.mockClear();
  await expect(preparePendingDocumentUpload(ctx, row, provider, Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS)).rejects.toThrow("Document storage operation failed.");
  expect(putObject).not.toHaveBeenCalled();
});

it("returns the stored failure message and code before storage inspection", async () => {
  mocks.read.mockResolvedValue({ ...row, uploadStatus: "failed", metadata: { uploadFailure: { reason: "expired" } } });
  await expect(prepareDocumentUpload(ctx, row.id)).rejects.toMatchObject({ code: "conflict", message: "This upload expired. Request a new upload to try again.", issues: [{ path: ["documentId"], code: "expired" }] });
  expect(mocks.owner).not.toHaveBeenCalled();
});
