import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), error: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./documents", () => ({ deleteDocumentRow: vi.fn() }));
vi.mock("./document-storage-deletions", () => ({ enqueueDocumentKeys: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.error } }));
import { sweepDocumentUploads } from "./document-upload-sweep";
import { DOCUMENT_SWEEP_BATCH_SIZE, DOCUMENT_SWEEP_BUDGET_MS } from "@/config/documents";
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });
it("commits multiple full batches before moving to retention", async () => {
  mocks.transaction.mockResolvedValueOnce(DOCUMENT_SWEEP_BATCH_SIZE).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
  expect(await sweepDocumentUploads()).toEqual({ expired: DOCUMENT_SWEEP_BATCH_SIZE + 1, retired: 0, failedPhases: [] });
  expect(mocks.transaction).toHaveBeenCalledTimes(3);
});
it("starts no more batches once the sweep budget is spent", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  mocks.transaction.mockImplementation(async () => {
    clock.mockReturnValue(DOCUMENT_SWEEP_BUDGET_MS);
    return DOCUMENT_SWEEP_BATCH_SIZE;
  });
  expect(await sweepDocumentUploads()).toEqual({ expired: DOCUMENT_SWEEP_BATCH_SIZE, retired: 0, failedPhases: [] });
  expect(mocks.transaction).toHaveBeenCalledOnce();
});
it.each(["expired", "retired"])("preserves counts and continues after %s fails", async (phase) => {
  mocks.transaction.mockResolvedValueOnce(DOCUMENT_SWEEP_BATCH_SIZE);
  if (phase === "retired") mocks.transaction.mockResolvedValueOnce(0);
  mocks.transaction.mockRejectedValueOnce(new Error("private storage details")).mockResolvedValueOnce(1);
  const result = await sweepDocumentUploads();
  expect(result).toEqual({ expired: DOCUMENT_SWEEP_BATCH_SIZE, retired: phase === "expired" ? 1 : 0, failedPhases: [phase] });
  expect(mocks.error).toHaveBeenCalledWith({ phase, expired: DOCUMENT_SWEEP_BATCH_SIZE, retired: 0 }, "Document upload sweep phase failed");
});
