// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { requestUpload, deleteDocument } from "@/fn/documents";
import { certificationKeys } from "./use-certification";
import { documentKeys, useDeleteDocument, useRequestUpload } from "./use-documents";
import { invalidateRecordLocksAfter, recordLockKeys } from "./record-lock-query-keys";

vi.mock("@/fn/documents", () => ({
  requestUpload: vi.fn(), deleteDocument: vi.fn(), confirmUpload: vi.fn(),
  setDocumentVisibility: vi.fn(), updateApplicationEvidenceMetadata: vi.fn(),
  getDocumentsForEntity: vi.fn(), canChangeDocumentVisibility: vi.fn(),
}));
afterEach(cleanup);
const refusal = { success: false, error: "Locked", code: "certification_locked" } as const;
function setup() {
  const client: QueryClient = new QueryClient({ mutationCache: new MutationCache({
    onSettled: (data, error, variables, _context, mutation) => invalidateRecordLocksAfter(client, data, error, mutation, variables),
  }) });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, invalidate, wrapper };
}
it("refreshes only the upload owner's locks when another session submits its lineage", async () => {
  vi.mocked(requestUpload).mockResolvedValue(refusal);
  const { wrapper, invalidate } = setup();
  const { result } = renderHook(() => useRequestUpload(), { wrapper });
  const input: Parameters<typeof requestUpload>[0] = { entityType: "production_run", entityId: "run-1", fileName: "evidence.pdf", contentType: "application/pdf", sizeBytes: 100, documentType: "pdf" };
  await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toMatchObject({ code: "certification_locked" }); });
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: certificationKeys.recordLock("production_run", "run-1") }],
    [{ queryKey: recordLockKeys.kind("productionRun") }],
  ]);
});
it("recovers the owner from the document query key on deletion and ignores unrelated refusals", async () => {
  const { wrapper, invalidate } = setup();
  const { result } = renderHook(() => useDeleteDocument(documentKeys.forEntity("sample", "sample-1")), { wrapper });
  vi.mocked(deleteDocument).mockResolvedValue(refusal);
  await act(async () => { await expect(result.current.mutateAsync({ documentId: "doc-1", expectedVersion: 1 })).rejects.toMatchObject({ code: "certification_locked" }); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: certificationKeys.recordLock("sample", "sample-1") });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: recordLockKeys.kind("sample") });
  expect(invalidate).toHaveBeenCalledTimes(2);
  invalidate.mockClear();
  vi.mocked(deleteDocument).mockResolvedValue({ success: false, error: "Try again", code: "validation_failed" });
  await act(async () => { await expect(result.current.mutateAsync({ documentId: "doc-1", expectedVersion: 1 })).rejects.toMatchObject({ code: "validation_failed" }); });
  expect(invalidate).not.toHaveBeenCalled();
});
