import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: vi.fn() }));
vi.mock("@/lib/documents/upload-preparation", () => ({ prepareDocumentUpload: vi.fn() }));
vi.mock("@/lib/storage", () => ({ getStorageProvider: vi.fn() }));
import { requireOrgContext } from "@/lib/auth/server";
import { runOperationInProcess } from "@/lib/operations/runner";
import { prepareDocumentUpload } from "@/lib/documents/upload-preparation";
import { getStorageProvider } from "@/lib/storage";
import { confirmUpload, requestUpload, deleteDocument, setDocumentVisibility, updateApplicationEvidenceMetadata } from "@/fn/documents";
import type { DocumentRow } from "@/data-access/documents";
const id = "12345678-1234-4234-8234-123456789abc";
const row = { id, storageKey: "org/org/uploads/doc/key", uploadStorageKey: "org/org/uploads/doc/key", uploadExpiresAt: new Date(Date.now() + 300_000), metadata: {} } as DocumentRow;
const presign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgContext).mockResolvedValue(makeTestOrgContext());
  vi.mocked(getStorageProvider).mockReturnValue({ name: "local-fs", bucket: "local-fs", createUploadUrl: presign } as unknown as ReturnType<typeof getStorageProvider>);
});
it("presigns only after the request commits, for no longer than its lease", async () => {
  vi.mocked(runOperationInProcess).mockResolvedValue(row);
  presign.mockImplementation(async (args) => {
    expect(runOperationInProcess).toHaveBeenCalledOnce();
    expect(args.key).toBe(row.uploadStorageKey);
    expect(args.expiresInSeconds * 1000).toBeLessThanOrEqual(row.uploadExpiresAt!.getTime() - Date.now());
    return { url: "http://localhost/upload", headers: { "Content-Type": "application/pdf" } };
  });
  expect(await requestUpload({ entityType: "sample", entityId: id, documentType: "pdf", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8 })).toMatchObject({ success: true, data: { documentId: id } });
});
it("answers an uploaded retry without entering the runner", async () => {
  vi.mocked(prepareDocumentUpload).mockResolvedValue({ kind: "uploaded", document: row });
  expect(await confirmUpload({ documentId: id })).toMatchObject({ success: true, data: row });
  expect(runOperationInProcess).not.toHaveBeenCalled();
});
it("maps a committed refusal after the runner resolves", async () => {
  vi.mocked(prepareDocumentUpload).mockResolvedValue({ kind: "prepared", facts: {} as never });
  vi.mocked(runOperationInProcess).mockResolvedValue({ kind: "refused", reason: "checksum", pointer: "/sha256", message: "The document upload could not be completed. Upload the file again.", document: row });
  expect(await confirmUpload({ documentId: id })).toMatchObject({ success: false, code: "validation_failed", issues: [{ path: ["sha256"] }] });
});
it.each([
  [deleteDocument, "delete_document_app"],
  [setDocumentVisibility, "set_document_visibility_app"],
  [updateApplicationEvidenceMetadata, "reclassify_application_evidence_app"],
] as const)("routes an app mutation through its unregistered operation", async (action, operationId) => {
  vi.mocked(runOperationInProcess).mockResolvedValue(row);
  expect(await action({ documentId: id })).toMatchObject({ success: true });
  expect(runOperationInProcess).toHaveBeenCalledWith(expect.objectContaining({ id: operationId }), expect.anything(), { documentId: id });
});
it("keeps authentication at the action boundary", async () => {
  vi.mocked(requireOrgContext).mockRejectedValue(new Error("Unauthorized"));
  expect(await requestUpload({})).toMatchObject({ success: false });
  expect(runOperationInProcess).not.toHaveBeenCalled();
});

it("floors the runner remainder at the DB reserve after slow preparation", async () => {
  const { DOCUMENT_CONFIRM_DB_RESERVE_MS, DOCUMENT_CONFIRM_DEADLINE_MS } = await import("@/config/documents");
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  vi.mocked(prepareDocumentUpload).mockImplementation(async () => {
    now.mockReturnValue(DOCUMENT_CONFIRM_DEADLINE_MS);
    return { kind: "prepared", facts: {} as never };
  });
  vi.mocked(runOperationInProcess).mockResolvedValue({ kind: "uploaded", document: row });
  try {
    expect(await confirmUpload({ documentId: id })).toMatchObject({ success: true });
    expect(runOperationInProcess).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), { deadlineMs: DOCUMENT_CONFIRM_DB_RESERVE_MS });
  } finally { now.mockRestore(); }
});
