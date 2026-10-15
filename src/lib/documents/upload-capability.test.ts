import { afterEach, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { runOperation } from "@/lib/operations/runner";
import { getStorageProvider } from "@/lib/storage";
import { LocalFsProvider, verifyLocalFsToken } from "@/lib/storage/local-fs";
import { mintDocumentUploadCapability } from "./upload-capability";

vi.mock("@/lib/operations/document-upload-renewal", () => ({ renewDocumentUpload: {} }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: vi.fn() }));
vi.mock("@/lib/storage", () => ({ getStorageProvider: vi.fn() }));

const ctx = { userId: "user", organizationId: "org", orgRole: "owner", isPlatformAdmin: false } satisfies OrgContext;
const signingInstant = Date.parse("2026-10-15T10:00:00Z");
const leaseMs = 5_500;
const signingDelayMs = 2_000;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("keeps a delayed local signer within the lease using the TTL calculation instant", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(signingInstant);
  const expiresAt = new Date(signingInstant + leaseMs).toISOString();
  vi.mocked(runOperation).mockResolvedValue({ data: {
    kind: "renewed", key: "org/org/uploads/doc/id", contentType: "application/pdf", sizeBytes: 8,
    expiresAt, provider: "local-fs", bucket: "local-fs",
  }, dryRun: false, replayed: false });
  const provider = new LocalFsProvider({ root: "/tmp/document-capability-unit", appUrl: "http://localhost", signingSecret: "test" });
  vi.mocked(getStorageProvider).mockReturnValue(provider);
  const createUploadUrl = provider.createUploadUrl.bind(provider);
  const sign = vi.spyOn(provider, "createUploadUrl").mockImplementation(async (args) => {
    vi.setSystemTime(signingInstant + signingDelayMs);
    return createUploadUrl(args);
  });
  const capability = await mintDocumentUploadCapability(ctx, "doc");
  expect(sign).toHaveBeenCalledWith(expect.objectContaining({ signingDate: new Date(signingInstant), expiresInSeconds: 5 }));
  expect(capability.upload?.expiresAt).toBe(expiresAt);
  const token = new URL(capability.upload!.url).searchParams.get("token")!;
  const claims = verifyLocalFsToken("test", token);
  expect(claims?.e).toBe(signingInstant + 5_000);
  expect(claims!.e).toBeLessThanOrEqual(Date.parse(expiresAt));
});
