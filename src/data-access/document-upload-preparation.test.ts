import { uploadFactsFor } from "./document-writes";
import type { DocumentRow } from "./documents";
import { beforeEach, expect, it, vi } from "vitest";
import { DOCUMENT_PROMOTION_CANDIDATE_LIMIT } from "@/config/documents";
const mocks = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), queued: [] as unknown[] }));
vi.mock("@/db", () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => fn({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.queued }) }) }),
  update: () => ({ set: (patch: unknown) => { mocks.update(patch); return { where: async () => {} }; } }),
}) } }));
vi.mock("./document-write-scope", async (original) => ({ ...await original<typeof import("./document-write-scope")>(), readDocumentForWrite: mocks.read }));
import { recordDocumentPromotionCandidate } from "./document-upload-preparation";
const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const row = { id: "doc", uploadStatus: "pending", uploadStorageKey: "upload", storageProvider: "local-fs", storageBucket: "local", metadata: { existing: true } };
const facts = uploadFactsFor(row as DocumentRow);
beforeEach(() => { vi.clearAllMocks(); mocks.queued = []; mocks.read.mockResolvedValue(row); });
it("records and deduplicates candidates without bumping the document version", async () => {
  mocks.read.mockResolvedValue({ ...row, metadata: { existing: true, promotionCandidates: ["final"] } });
  await recordDocumentPromotionCandidate(ctx, facts, "final");
  expect(mocks.read).toHaveBeenCalledWith(ctx, expect.anything(), "doc", true);
  expect(mocks.update).toHaveBeenCalledWith({ metadata: { existing: true, promotionCandidates: ["final"] } });
});
it.each([null, { ...row, uploadStorageKey: "other" }, { ...row, entityId: "other" }])("returns gone for stale bindings (%j)", async (current) => {
  mocks.read.mockResolvedValue(current);
  await expect(recordDocumentPromotionCandidate(ctx, facts, "final")).resolves.toEqual({ kind: "gone" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it.each(["uploaded", "failed"])("returns the stored %s row without a write", async (uploadStatus) => {
  const current = { ...row, uploadStatus, metadata: { uploadFailure: { reason: "expired" } } };
  mocks.read.mockResolvedValue(current);
  await expect(recordDocumentPromotionCandidate(ctx, facts, "final")).resolves.toEqual({ kind: uploadStatus, document: current });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("never forgets an old candidate when the bounded list fills", async () => {
  mocks.read.mockResolvedValue({ ...row, metadata: { promotionCandidates: Array.from({ length: DOCUMENT_PROMOTION_CANDIDATE_LIMIT }, (_, index) => `key-${index}`) } });
  await expect(recordDocumentPromotionCandidate(ctx, facts, "new-key")).rejects.toMatchObject({ code: "conflict" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("refuses to reuse a candidate already handed off to cleanup", async () => {
  mocks.queued = [{ id: "deletion" }];
  await expect(recordDocumentPromotionCandidate(ctx, facts, "final")).rejects.toMatchObject({ code: "conflict" });
  expect(mocks.update).not.toHaveBeenCalled();
});
