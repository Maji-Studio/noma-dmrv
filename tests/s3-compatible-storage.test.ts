import { describe, expect, it } from "vitest";
import { S3CompatibleProvider } from "@/lib/storage/s3-compatible";

const BASE_CONFIG = {
  bucket: "maji",
  region: "fra1",
  endpoint: "https://fra1.digitaloceanspaces.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

describe("S3-compatible storage prefix", () => {
  it("adds the prefix to presigned upload and download object paths", async () => {
    const provider = new S3CompatibleProvider({
      ...BASE_CONFIG,
      prefix: "noma-dmrv/staging",
    });

    const upload = await provider.createUploadUrl({
      key: "org/org-1/uploads/doc-1/upload",
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    const download = await provider.createDownloadUrl({
      key: "org/org-1/uploads/doc-1/upload",
    });

    expect(new URL(upload.url).pathname).toBe(
      "/maji/noma-dmrv/staging/org/org-1/uploads/doc-1/upload"
    );
    expect(new URL(download).pathname).toBe(
      "/maji/noma-dmrv/staging/org/org-1/uploads/doc-1/upload"
    );
  });

  it("preserves existing object paths when the optional prefix is absent", async () => {
    const provider = new S3CompatibleProvider(BASE_CONFIG);

    const upload = await provider.createUploadUrl({
      key: "org/org-1/uploads/doc-1/upload",
      contentType: "application/pdf",
      maxBytes: 1024,
    });

    expect(new URL(upload.url).pathname).toBe(
      "/maji/org/org-1/uploads/doc-1/upload"
    );
  });

  it.each([
    "/leading",
    "trailing/",
    "double//slash",
    "parent/../segment",
    "embedded..dots",
  ])(
    "rejects unsafe prefix %s",
    (prefix) => {
      expect(
        () => new S3CompatibleProvider({ ...BASE_CONFIG, prefix })
      ).toThrow(/STORAGE_PREFIX/);
    }
  );
});
