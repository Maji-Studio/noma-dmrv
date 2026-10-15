import { beforeEach, expect, it, vi } from "vitest";
import type { ApiContext } from "@/lib/auth/api-context";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), run: vi.fn(), mint: vi.fn() }));
vi.mock("@/lib/read-models/api-documents", () => ({ resolveApiDocumentOwner: mocks.resolve }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("./upload-capability", () => ({ mintDocumentUploadCapability: mocks.mint }));
import { requestDocumentUploadWithCapability } from "./upload-request";
const ctx = { organizationId: "org" } as ApiContext;
const ownerId = "12345678-1234-4234-8234-123456789abc";
const result = { data: { id: "doc", ownerId }, replayed: true, dryRun: false };
beforeEach(() => { vi.clearAllMocks(); mocks.run.mockResolvedValue(result); mocks.resolve.mockResolvedValue(ownerId); });
it.each([ownerId.toUpperCase(), "DL-1"])("resolves %s and mints a fresh capability after replay", async identifier => {
  const upload = { url: "https://example.test/upload" };
  mocks.mint.mockResolvedValue({ upload });
  const response = await requestDocumentUploadWithCapability(ctx, "delivery", identifier, { documentType: "pdf" }, { deadlineAt: Date.now() + 1000, idempotency: { credentialId: "credential", key: "key" } });
  expect(response).toEqual({ result, body: { data: result.data, upload } });
  expect(mocks.run).toHaveBeenCalledWith(expect.anything(), ctx, { documentType: "pdf", ownerType: "delivery", ownerId }, expect.objectContaining({ idempotency: { credentialId: "credential", key: "key" } }));
  expect(mocks.mint).toHaveBeenCalledWith(ctx, "doc", { deadlineMs: expect.any(Number) });
  if (identifier === "DL-1") expect(mocks.resolve).toHaveBeenCalledWith(ctx, "delivery", { code: identifier });
  else expect(mocks.resolve).not.toHaveBeenCalled();
});
it("preserves the shared warning envelope when no capability is available", async () => {
  mocks.mint.mockResolvedValue({ upload: null, warning: "Already uploaded." });
  const response = await requestDocumentUploadWithCapability(ctx, "delivery", ownerId, {}, { deadlineAt: Date.now() + 1000 });
  expect(response.body).toEqual({ data: result.data, upload: null, warnings: ["Already uploaded."] });
});
