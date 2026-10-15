import { afterEach, expect, it, vi } from "vitest";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3CompatibleProvider } from "./s3-compatible";

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));
const signingInstant = Date.parse("2026-10-15T10:00:00Z");
const signingDelayMs = 2_000;
const ttlSeconds = 5;
const millisecondsPerSecond = 1_000;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("forwards the fixed signing instant and reports that expiry even when the signer is delayed", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(signingInstant);
  vi.mocked(getSignedUrl).mockImplementation(async () => {
    vi.setSystemTime(signingInstant + signingDelayMs);
    return "https://fake.test/upload";
  });
  const provider = new S3CompatibleProvider({ bucket: "fake", region: "test", accessKeyId: "test", secretAccessKey: "test", prefix: "test" });
  const signingDate = new Date(signingInstant);
  const signed = await provider.createUploadUrl({ key: "org/org/uploads/doc/id", contentType: "application/pdf", maxBytes: 8, expiresInSeconds: ttlSeconds, signingDate });
  expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: ttlSeconds, signingDate });
  expect(signed.expiresAt.getTime()).toBe(signingInstant + ttlSeconds * millisecondsPerSecond);
});
