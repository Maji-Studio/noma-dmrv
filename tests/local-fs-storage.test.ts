import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = {
  STORAGE_SIGNING_SECRET: process.env.STORAGE_SIGNING_SECRET,
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();
});

describe("local-fs storage", () => {
  it("falls back to BETTER_AUTH_SECRET for stable dev/test upload signatures", async () => {
    const sharedSecret = "shared-local-fs-secret-32-chars-min";
    process.env.STORAGE_PROVIDER = "local-fs";
    process.env.BETTER_AUTH_SECRET = sharedSecret;
    delete process.env.STORAGE_SIGNING_SECRET;
    vi.resetModules();

    const [{ getStorageProvider }, { verifyLocalFsToken }] = await Promise.all([
      import("@/lib/storage"),
      import("@/lib/storage/local-fs"),
    ]);

    const provider = getStorageProvider();
    const upload = await provider.createUploadUrl({
      key: "application/app-1/photo/evidence.jpg",
      contentType: "image/jpeg",
      maxBytes: 1024,
    });
    const token = new URL(upload.url).searchParams.get("token");

    expect(token).toBeTruthy();
    expect(verifyLocalFsToken(sharedSecret, token ?? "")).toMatchObject({
      k: "application/app-1/photo/evidence.jpg",
      m: "PUT",
      c: "image/jpeg",
    });
  });
});
