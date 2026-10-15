import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFsProvider } from "./local-fs";
import { buildUploadKey, buildFinalStorageKey } from "./keys";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
it("separates writable upload keys from immutable final keys without filenames", async () => {
  const root = await mkdtemp(join(tmpdir(), "document-storage-")); roots.push(root);
  const provider = new LocalFsProvider({ root, appUrl: "http://localhost", signingSecret: "test" });
  const key = buildUploadKey({ organizationId: "org-id", documentId: "doc-id" });
  expect(key).toMatch(/^org\/org-id\/uploads\/doc-id\/[a-z0-9]+$/);
  await expect(provider.createUploadUrl({ key: "org/org-id/sample/id/pdf/final.pdf", contentType: "application/pdf", maxBytes: 10 })).rejects.toMatchObject({ code: "unsafe_upload_key" });
  expect(buildFinalStorageKey({ organizationId: "org-id", documentId: "doc-id", entityType: "sample", entityId: "sample-id", documentType: "pdf", sha256: "a".repeat(64), fileName: "private name.PDF" })).toBe(`org/org-id/sample/sample-id/pdf/doc-id-${"a".repeat(64)}.pdf`);
});
it("bounds reads, hashes bytes, returns null for missing objects and respects abort", async () => {
  const root = await mkdtemp(join(tmpdir(), "document-storage-")); roots.push(root);
  const provider = new LocalFsProvider({ root, appUrl: "http://localhost", signingSecret: "test" });
  await provider.putObject("org/test/uploads/doc/id", Buffer.from("abc"), "text/plain");
  expect(await provider.readObjectBounded({ key: "missing", maxBytes: 3 })).toBeNull();
  expect(await provider.readObjectBounded({ key: "org/test/uploads/doc/id", maxBytes: 3 })).toEqual({ bytes: Buffer.from("abc"), sizeBytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", contentType: "text/plain" });
  await expect(provider.readObjectBounded({ key: "org/test/uploads/doc/id", maxBytes: 2 })).rejects.toMatchObject({ code: "object_too_large" });
  await expect(provider.readObjectBounded({ key: "org/test/uploads/doc/id", maxBytes: 3, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
});
