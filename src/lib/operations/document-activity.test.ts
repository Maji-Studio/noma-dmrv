import { beforeEach, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { requestDocumentUploadApp, confirmDocumentUploadApp, deleteDocumentApp, setDocumentVisibilityApp } from "./documents";
import { runOperationInProcess, type OperationScope } from "./runner";

const mocks = vi.hoisted(() => ({ record: vi.fn(), request: vi.fn(), confirm: vi.fn(), remove: vi.fn(), visibility: vi.fn() }));
vi.mock("@/data-access/activity-events", () => ({ recordActivity: mocks.record }));
vi.mock("@/data-access/owned-transaction", () => ({
  runOwnedTransaction: async (_ctx: unknown, _deadline: unknown, callback: (tx: OperationScope["tx"]) => Promise<unknown>) => ({ kind: "committed", data: await callback(tx) }),
}));
vi.mock("@/data-access/document-writes", () => ({ requestDocumentUploadInTransaction: mocks.request, confirmDocumentUploadInTransaction: mocks.confirm }));
vi.mock("@/data-access/document-mutations", () => ({ deleteDocumentInTransaction: mocks.remove, setDocumentVisibilityInTransaction: mocks.visibility, updateApplicationEvidenceMetadataInTransaction: vi.fn() }));
vi.mock("@/data-access/storage-object-deletions", () => ({ processPendingStorageObjectDeletions: vi.fn() }));
const tx = {} as OperationScope["tx"];
const ctx = { userId: "user-id", organizationId: "org-id", orgRole: "admin", isPlatformAdmin: false } satisfies OrgContext;
const documentId = "12345678-1234-4234-8234-123456789abc";
const ownerId = "12345678-1234-4234-8234-123456789def";

beforeEach(() => { vi.clearAllMocks(); });

it.each(["feedstock", "sample"] as const)("records owner reasons through real %s document operations", async entityType => {
  const document = { id: documentId, entityType, entityId: ownerId, documentType: "pdf", version: 1 };
  mocks.request.mockResolvedValue(document);
  await runOperationInProcess(requestDocumentUploadApp, ctx, {
    entityType, entityId: ownerId, documentType: "pdf", fileName: "evidence.pdf",
    contentType: "application/pdf", sizeBytes: 8, storageProvider: "local-fs", storageBucket: "local-fs",
  });
  mocks.confirm.mockResolvedValue({ kind: "uploaded", document: { ...document, version: 2 }, transitioned: true });
  await runOperationInProcess(confirmDocumentUploadApp, ctx, {
    documentId, entityType, entityId: ownerId, documentType: "pdf", provider: "local-fs", bucket: "local-fs",
    uploadKey: "upload", contentType: "application/pdf", sizeBytes: 8, sha256: null,
  });
  mocks.visibility.mockResolvedValue({ ...document, version: 3 });
  await runOperationInProcess(setDocumentVisibilityApp, ctx, { documentId, expectedVersion: 2, visibility: "private" });
  mocks.remove.mockResolvedValue({ ...document, version: 3 });
  await runOperationInProcess(deleteDocumentApp, ctx, { documentId, expectedVersion: 3 });
  expect(mocks.record).toHaveBeenCalledTimes(4);
  for (const [index, action] of ["created", "updated", "updated", "deleted"].entries()) {
    expect(mocks.record).toHaveBeenNthCalledWith(index + 1, ctx, tx, expect.objectContaining({
      entityType: "document", entityId: documentId, action, reasonCode: `document:pdf:${entityType}:${ownerId}`,
    }));
  }
});
