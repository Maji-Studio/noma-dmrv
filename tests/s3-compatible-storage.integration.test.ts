import { randomUUID } from "node:crypto";
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
import { STORAGE_GET_OBJECT_TIMEOUT_MS } from "@/lib/storage/get-object";
import { S3CompatibleProvider, type S3CompatibleConfig } from "@/lib/storage/s3-compatible";

const MINIO_ENV_NAMES = [
  "MINIO_TEST_ENDPOINT",
  "MINIO_TEST_REGION",
  "MINIO_TEST_ACCESS_KEY_ID",
  "MINIO_TEST_SECRET_ACCESS_KEY",
] as const;
const HAS_MINIO_ENV = MINIO_ENV_NAMES.some((name) => Boolean(process.env[name]));
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HOOK_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = STORAGE_GET_OBJECT_TIMEOUT_MS + HOOK_TIMEOUT_MS;
const HTTP_TIMEOUT_MS = 5_000;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const FIRST_BYTE_LENGTH = 1;
const CONTENT_TYPE = "application/pdf";
const PAYLOAD = Buffer.from([0x00, 0xff, 0x80, 0x01, 0x0a, 0x42]);
const PREFIX = "integration/nested-prefix";

if (!HAS_MINIO_ENV) {
  // Vitest suppresses intercepted console output from a skipped suite.
  process.stdout.write("MinIO storage integration tests skipped: MINIO_TEST_* env is absent.\n");
}

// Forward a real signed MinIO GET, but withhold the body after its first byte.
// Keep the signed Host header intact when forwarding through the loopback proxy.
async function startStalledProxy(endpoint: string) {
  let upstreamStatus: number | undefined;
  let sentFirstByte = false;
  let clientClosed = false;
  const server = createServer((incoming, outgoing) => {
    const upstream = request(new URL(incoming.url!, endpoint), {
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
  let config: S3CompatibleConfig;
  let client: S3Client;
  let provider: S3CompatibleProvider;

  beforeAll(async () => {
    for (const name of MINIO_ENV_NAMES) {
      if (!process.env[name]) throw new Error(`MinIO integration tests require ${name}`);
    }
    const endpoint = new URL(process.env.MINIO_TEST_ENDPOINT!);
    if (
      endpoint.protocol !== "http:" || !LOOPBACK_HOSTS.has(endpoint.hostname) ||
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

    const response = await fetch(await provider.createDownloadUrl({ key }), {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toBe(CONTENT_TYPE);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PAYLOAD);
  });

  it("uploads through a real presigned PUT and getObject returns exact bytes and content type", async () => {
    const key = "org/minio/uploads/document/presigned-object";
    const upload = await provider.createUploadUrl({ key, contentType: CONTENT_TYPE, maxBytes: PAYLOAD.length });
    const response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: new Uint8Array(PAYLOAD),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    await response.arrayBuffer();
    expect(response.status).toBe(HTTP_OK);
    expect(await provider.getObject({ key })).toEqual({ bytes: PAYLOAD, contentType: CONTENT_TYPE });
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
    const response = await fetch(await provider.createDownloadUrl({ key }), {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
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
    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: new Uint8Array(PAYLOAD),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    expect(put.status).toBe(HTTP_FORBIDDEN);
    expect(await put.text()).toContain("SignatureDoesNotMatch");
    const get = await fetch(await unauthorized.createDownloadUrl({ key }), {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
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
      await expect(stalled.getObject({ key })).rejects.toMatchObject({
        name: "StorageError",
        code: "get_object_timeout",
      });
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
