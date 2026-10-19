import { beforeEach, expect, it, vi } from "vitest";
import { DOCUMENT_DOWNLOAD_TTL_SECONDS } from "@/config/documents";
import type { ApiContext } from "@/lib/auth/api-context";
const mocks = vi.hoisted(() => ({ read: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/read-models/api-documents", async original => ({ ...await original<typeof import("@/lib/read-models/api-documents")>(), readApiDocument: mocks.read }));
vi.mock("@/lib/storage", () => ({ getStorageProvider: () => ({ createDownloadUrl: mocks.sign }) }));
import { documentDownloadUrl } from "./download-url";
const ctx = { organizationId: "org" } as ApiContext;
beforeEach(() => { vi.clearAllMocks(); mocks.sign.mockResolvedValue("https://example.test/download"); });
it.each([{ uploadStatus: "pending", storageKey: "key" }, { uploadStatus: "failed", storageKey: "key" }, { uploadStatus: "uploaded", storageKey: null }])("refuses unavailable content before signing (%j)", async row => {
  mocks.read.mockResolvedValue(row);
  await expect(documentDownloadUrl(ctx, "delivery", "owner", "doc")).rejects.toMatchObject({ code: "not_found" });
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("signs an owner-scoped uploaded key with the shared TTL", async () => {
  mocks.read.mockResolvedValue({ uploadStatus: "uploaded", storageKey: "key" });
  expect(await documentDownloadUrl(ctx, "delivery", "owner", "doc")).toMatchObject({ url: "https://example.test/download", expiresAt: expect.any(String) });
  expect(mocks.read).toHaveBeenCalledWith(ctx, "delivery", "owner", "doc");
  expect(mocks.sign).toHaveBeenCalledWith({ key: "key", expiresInSeconds: DOCUMENT_DOWNLOAD_TTL_SECONDS });
});
