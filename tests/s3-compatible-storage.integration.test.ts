import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, request } from "node:http";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3CompatibleProvider, type S3CompatibleConfig } from "@/lib/storage/s3-compatible";
import type { PresignedUpload } from "@/lib/storage/types";
import { isLocalHost } from "./helpers/local-host";

const MINIO_ENV_NAMES = [
  "MINIO_TEST_ENDPOINT",
  "MINIO_TEST_REGION",
  "MINIO_TEST_ACCESS_KEY_ID",
  "MINIO_TEST_SECRET_ACCESS_KEY",
] as const;
const HAS_MINIO_ENV = MINIO_ENV_NAMES.some((name) => Boolean(process.env[name]));
const HOOK_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 15_000;
const GET_OBJECT_TIMEOUT_MS = 1_000;
const ABORT_ELAPSED_LIMIT_MS = 5_000;
const EXPIRED_UPLOAD_TTL_SECONDS = 60;
const EXPIRED_SIGNING_AGE_MS = 10 * 60 * 1_000;
const HTTP_TIMEOUT_MS = 5_000;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const FIRST_BYTE_LENGTH = 1;
const CONTENT_TYPE = "application/pdf";
const DIFFERENT_CONTENT_TYPE = "text/plain";
const PAYLOAD = Buffer.from([0x00, 0xff, 0x80, 0x01, 0x0a, 0x42]);
const PREFIX = "integration/nested-prefix";

if (!HAS_MINIO_ENV) {
  // Vitest suppresses intercepted console output from a skipped suite.
  process.stdout.write("MinIO storage integration tests skipped: MINIO_TEST_* env is absent.\n");
}

function putPresigned(upload: PresignedUpload, body: Buffer) {
  return fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

function getPresigned(url: string) {
  return fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
}

// Forward a real signed MinIO GET, but withhold the body after its first byte.
// Keep the signed Host header intact when forwarding through the loopback proxy.
async function startStalledProxy(endpoint: string) {
  const minio = new URL(endpoint);
  let upstreamStatus: number | undefined;
  let sentFirstByte = false;
  let clientClosed = false;
  const server = createServer((incoming, outgoing) => {
    const target = incoming.url;
    if (!target || !/^\/(?![/\\])[^\\#]*$/.test(target)) {
      outgoing.writeHead(HTTP_BAD_REQUEST).end();
      return;
    }
    const upstreamUrl = new URL(minio.origin);
    const queryIndex = target.indexOf("?");
    upstreamUrl.pathname = queryIndex === -1 ? target : target.slice(0, queryIndex);
    upstreamUrl.search = queryIndex === -1 ? "" : target.slice(queryIndex);
    expect(upstreamUrl.origin).toBe(minio.origin);
    // Only path/search come from the request; connection coordinates stay fixed.
    const upstream = request({
      protocol: minio.protocol,
      hostname: minio.hostname.replace(/^\[|\]$/g, ""),
      port: minio.port,
      path: upstreamUrl.pathname + upstreamUrl.search,
      headers: incoming.headers,
      timeout: HTTP_TIMEOUT_MS,
    }, (response) => {
      upstreamStatus = response.statusCode;
      outgoing.writeHead(response.statusCode!, response.headers);
      response.on("data", (chunk: Buffer) => {
        if (!sentFirstByte) {
          sentFirstByte = true;
          outgoing.write(chunk.subarray(0, FIRST_BYTE_LENGTH));
        }
      });
      response.on("error", (error) => outgoing.destroy(error));
      // Deliberately never end outgoing, even when MinIO finishes sending.
    });
    upstream.on("timeout", () => upstream.destroy(new Error("MinIO proxy upstream timed out")));
    upstream.on("error", (error) => outgoing.destroy(error));
    outgoing.on("close", () => {
      clientClosed = true;
      upstream.destroy();
    });
    upstream.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("MinIO proxy did not bind TCP");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    state: () => ({ upstreamStatus, sentFirstByte, clientClosed }),
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

describe.skipIf(!HAS_MINIO_ENV)("S3-compatible storage against MinIO", {
  timeout: TEST_TIMEOUT_MS,
}, () => {
  describe("MinIO stalling proxy request targets", () => {
    it.each(["http://example.invalid/object", "//example.invalid/object", "/\\example.invalid/object", "/object#fragment", "*"])(
      "rejects non-origin-form target %s before forwarding",
      async (target) => {
        const proxy = await startStalledProxy("http://127.0.0.1");
        try {
          const response = await new Promise<number | undefined>((resolve, reject) => {
            const rejected = request(proxy.endpoint, { path: target, timeout: HTTP_TIMEOUT_MS }, (incoming) => {
              incoming.resume();
              resolve(incoming.statusCode);
            });
            rejected.on("error", reject);
            rejected.on("timeout", () => rejected.destroy(new Error("Proxy request timed out")));
            rejected.end();
          });
          expect(response).toBe(HTTP_BAD_REQUEST);
          expect(proxy.state().upstreamStatus).toBeUndefined();
        } finally {
          await proxy.close();
        }
      },
    );
  });

  let config: S3CompatibleConfig;
  let client: S3Client;
  let provider: S3CompatibleProvider;

  beforeAll(async () => {
    for (const name of MINIO_ENV_NAMES) {
      if (!process.env[name]) throw new Error(`MinIO integration tests require ${name}`);
    }
    const endpoint = new URL(process.env.MINIO_TEST_ENDPOINT!);
    if (
      endpoint.protocol !== "http:" || !isLocalHost(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.pathname !== "/" ||
      endpoint.search || endpoint.hash
    ) {
      throw new Error("MINIO_TEST_ENDPOINT must be an HTTP loopback origin for disposable MinIO");
    }
    // Never use the app singleton or STORAGE_* settings, including its bucket.
    config = {
      endpoint: endpoint.origin,
      region: process.env.MINIO_TEST_REGION!,
      accessKeyId: process.env.MINIO_TEST_ACCESS_KEY_ID!,
      secretAccessKey: process.env.MINIO_TEST_SECRET_ACCESS_KEY!,
      bucket: `minio-test-${randomUUID()}`,
      prefix: PREFIX,
    };
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: config,
      forcePathStyle: true,
      maxAttempts: 1,
    });
    provider = new S3CompatibleProvider(config);
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (!client || !config) return;
      // Drain the unique bucket, including objects left behind by failed tests.
      let continuationToken: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket,
          ContinuationToken: continuationToken,
        }));
        for (const object of page.Contents ?? []) {
          await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: object.Key! }));
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken);
      await client.send(new DeleteBucketCommand({ Bucket: config.bucket }));
    } catch (error) {
      if (!(error instanceof Error && error.name === "NoSuchBucket")) throw error;
    } finally {
      client?.destroy();
    }
  }, HOOK_TIMEOUT_MS);

  it("uploads server bytes, reads metadata and downloads through a real presigned GET", async () => {
    const key = "org/minio/generated/server-object.bin";
    await provider.putObject(key, PAYLOAD, CONTENT_TYPE);
    expect(await provider.headObject(key)).toMatchObject({
      size: PAYLOAD.length,
      contentType: CONTENT_TYPE,
      etag: expect.any(String),
    });
    const objects = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: `${PREFIX}/${key}`,
    }));
    expect(objects.Contents?.map((object) => object.Key)).toEqual([`${PREFIX}/${key}`]);

    const response = await getPresigned(await provider.createDownloadUrl({ key }));
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toBe(CONTENT_TYPE);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PAYLOAD);
  });

  it("uploads through a real presigned PUT and getObject returns exact bytes and content type", async () => {
    const key = "org/minio/uploads/document/presigned-object";
    const upload = await provider.createUploadUrl({ key, contentType: CONTENT_TYPE, maxBytes: PAYLOAD.length });
    const response = await putPresigned(upload, PAYLOAD);
    await response.arrayBuffer();
    expect(response.status).toBe(HTTP_OK);
    expect(await provider.getObject({ key })).toEqual({ bytes: PAYLOAD, contentType: CONTENT_TYPE });
  });

  it("accepts a presigned PUT with a different Content-Type and stores the supplied type", async () => {
    const key = "org/minio/uploads/document/different-content-type";
    const upload = await provider.createUploadUrl({ key, contentType: CONTENT_TYPE, maxBytes: PAYLOAD.length });
    // The current signer does not include Content-Type in its signed headers.
    expect(new URL(upload.url).searchParams.get("X-Amz-SignedHeaders")?.split(";")).not.toContain("content-type");
    const response = await putPresigned({
      ...upload,
      headers: { ...upload.headers, "Content-Type": DIFFERENT_CONTENT_TYPE },
    }, PAYLOAD);
    await response.arrayBuffer();
    expect(response.status).toBe(HTTP_OK);
    expect(await provider.headObject(key)).toMatchObject({ contentType: DIFFERENT_CONTENT_TYPE });
    expect(await provider.getObject({ key })).toEqual({ bytes: PAYLOAD, contentType: DIFFERENT_CONTENT_TYPE });
  });

  it("rejects an expired presigned PUT without creating the object", async () => {
    const key = "org/minio/uploads/document/expired-object";
    const upload = await provider.createUploadUrl({
      key,
      contentType: CONTENT_TYPE,
      maxBytes: PAYLOAD.length,
      signingDate: new Date(Date.now() - EXPIRED_SIGNING_AGE_MS),
      expiresInSeconds: EXPIRED_UPLOAD_TTL_SECONDS,
    });
    const response = await putPresigned(upload, PAYLOAD);
    expect(response.status).toBe(HTTP_FORBIDDEN);
    expect(await response.text()).toContain("Request has expired");
    expect(await provider.headObject(key)).toBeNull();
  });

  it("bounds presigned uploads on read and returns exact inspection facts or null", async () => {
    const key = "org/minio/uploads/document/bounded-object";
    const maxBytes = PAYLOAD.length - FIRST_BYTE_LENGTH;
    const upload = await provider.createUploadUrl({ key, contentType: CONTENT_TYPE, maxBytes });
    const response = await putPresigned(upload, PAYLOAD);
    await response.arrayBuffer();
    expect(response.status).toBe(HTTP_OK);
    await expect(provider.readObjectBounded({ key, maxBytes })).rejects.toMatchObject({
      name: "StorageError",
      code: "object_too_large",
    });
    expect(await provider.readObjectBounded({ key, maxBytes: PAYLOAD.length })).toEqual({
      bytes: PAYLOAD,
      sizeBytes: PAYLOAD.length,
      sha256: createHash("sha256").update(PAYLOAD).digest("hex"),
      contentType: CONTENT_TYPE,
    });
    expect(await provider.readObjectBounded({
      key: "org/minio/uploads/document/missing-bounded-object",
      maxBytes: PAYLOAD.length,
    })).toBeNull();
  });

  it("deletes an object and subsequent reads report it missing", async () => {
    const key = "org/minio/generated/delete-object.bin";
    await provider.putObject(key, PAYLOAD, CONTENT_TYPE);
    expect(await provider.headObject(key)).not.toBeNull();
    await provider.deleteObject(key);
    expect(await provider.headObject(key)).toBeNull();
    await expect(provider.getObject({ key })).rejects.toMatchObject({ code: "get_object_failed" });
    await expect(provider.deleteObject(key)).resolves.toBeUndefined();
  });

  it("reports missing objects through HEAD, presigned GET and getObject", async () => {
    const key = "org/minio/generated/never-uploaded.bin";
    expect(await provider.headObject(key)).toBeNull();
    const response = await getPresigned(await provider.createDownloadUrl({ key }));
    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.text()).toContain("NoSuchKey");
    await expect(provider.getObject({ key })).rejects.toMatchObject({
      name: "StorageError",
      code: "get_object_failed",
      message: `Stored object read failed with status ${HTTP_NOT_FOUND}`,
    });
  });

  it("refuses SDK writes, HEAD, DELETE and signed HTTP requests with wrong credentials", async () => {
    const key = "org/minio/uploads/document/unauthorized-object";
    await provider.putObject(key, PAYLOAD, CONTENT_TYPE);
    const unauthorized = new S3CompatibleProvider({
      ...config,
      secretAccessKey: randomUUID(),
    });
    const forbidden = { $metadata: { httpStatusCode: HTTP_FORBIDDEN } };
    await expect(unauthorized.putObject(key, PAYLOAD, CONTENT_TYPE)).rejects.toMatchObject(forbidden);
    await expect(unauthorized.headObject(key)).rejects.toMatchObject(forbidden);
    await expect(unauthorized.deleteObject(key)).rejects.toMatchObject(forbidden);
    const upload = await unauthorized.createUploadUrl({ key, contentType: CONTENT_TYPE, maxBytes: PAYLOAD.length });
    const put = await putPresigned(upload, PAYLOAD);
    expect(put.status).toBe(HTTP_FORBIDDEN);
    expect(await put.text()).toContain("SignatureDoesNotMatch");
    const get = await getPresigned(await unauthorized.createDownloadUrl({ key }));
    expect(get.status).toBe(HTTP_FORBIDDEN);
    expect(await get.text()).toContain("SignatureDoesNotMatch");
    await expect(unauthorized.getObject({ key })).rejects.toMatchObject({
      code: "get_object_failed",
      message: `Stored object read failed with status ${HTTP_FORBIDDEN}`,
    });
    expect(await provider.getObject({ key })).toEqual({ bytes: PAYLOAD, contentType: CONTENT_TYPE });
  });

  it("aborts a stalled real MinIO response body at the getObject deadline", async () => {
    const key = "org/minio/generated/deadline-object.bin";
    await provider.putObject(key, PAYLOAD, CONTENT_TYPE);
    const proxy = await startStalledProxy(config.endpoint!);
    try {
      const stalled = new S3CompatibleProvider({ ...config, endpoint: proxy.endpoint });
      const startedAt = performance.now();
      await expect(stalled.getObject({ key }, GET_OBJECT_TIMEOUT_MS)).rejects.toMatchObject({
        name: "StorageError",
        code: "get_object_timeout",
      });
      expect(performance.now() - startedAt).toBeLessThan(ABORT_ELAPSED_LIMIT_MS);
      await expect.poll(proxy.state).toEqual({
        upstreamStatus: HTTP_OK,
        sentFirstByte: true,
        clientClosed: true,
      });
    } finally {
      await proxy.close();
    }
  });
});
