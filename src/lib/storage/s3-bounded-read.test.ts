import { afterEach, expect, it, vi } from "vitest";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { S3CompatibleProvider } from "./s3-compatible";
const provider = () => new S3CompatibleProvider({ bucket: "fake", region: "test", accessKeyId: "test", secretAccessKey: "test", prefix: "test" });
afterEach(() => vi.restoreAllMocks());
it("streams, hashes and passes the abort signal to the fake S3 client", async () => {
  const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ Body: Readable.from([Buffer.from("a"), Buffer.from("bc")]), ContentType: "text/plain", ETag: "not-a-checksum" } as never);
  const signal = new AbortController().signal;
  expect(await provider().readObjectBounded({ key: "key", maxBytes: 3, signal })).toMatchObject({ sizeBytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  expect(send).toHaveBeenCalledWith(expect.any(GetObjectCommand), { abortSignal: signal });
});
it("stops consuming oversized bodies and treats missing objects as null", async () => {
  let readAfterLimit = false;
  const body = Readable.from((async function* () { yield Buffer.alloc(4); yield Buffer.alloc(4); readAfterLimit = true; yield Buffer.alloc(4); })(), { highWaterMark: 1 });
  const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ Body: body, ContentType: "text/plain" } as never);
  await expect(provider().readObjectBounded({ key: "key", maxBytes: 3 })).rejects.toMatchObject({ code: "object_too_large" });
  expect(readAfterLimit).toBe(false); expect(body.destroyed).toBe(true);
  send.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
  expect(await provider().readObjectBounded({ key: "missing", maxBytes: 3 })).toBeNull();
});
it("never presigns a final key and carries verified checksums on server writes", async () => {
  const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
  await expect(provider().createUploadUrl({ key: "org/test/sample/id/pdf/final.pdf", contentType: "application/pdf", maxBytes: 10 })).rejects.toMatchObject({ code: "unsafe_upload_key" });
  await provider().putObject("final", Buffer.from("abc"), "text/plain", { checksumSha256: "a".repeat(64) });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ Key: "test/final", ChecksumSHA256: Buffer.from("a".repeat(64), "hex").toString("base64") }) }), { abortSignal: undefined });
  expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
});

it("preserves a missing bucket error for configuration classification", async () => {
  const cause = Object.assign(new Error("missing bucket"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } });
  vi.spyOn(S3Client.prototype, "send").mockRejectedValue(cause);
  await expect(provider().readObjectBounded({ key: "key", maxBytes: 3 })).rejects.toBe(cause);
});
