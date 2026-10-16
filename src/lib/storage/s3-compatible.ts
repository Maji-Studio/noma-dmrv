import type { Readable } from "node:stream";
import { readBoundedStream } from "./bounded-read";
import { boundedReadError } from "./bounded-read-error";
import { StorageError, type ReadObjectBoundedArgs, type PutObjectOptions } from "./types";
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
  NotFound,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  StorageProvider,
  StorageProviderName,
  PresignedUpload,
  ObjectHead,
  CreateUploadUrlArgs,
  CreateDownloadUrlArgs,
  GetObjectArgs,
  StoredObject,
} from "./types";
import { isSafeStorageKey, isUploadKey } from "./keys";
import { fetchStoredObject } from "./get-object";

const DEFAULT_UPLOAD_TTL_SECONDS = 60 * 5;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 60 * 5;

export interface S3CompatibleConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  prefix?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3CompatibleProvider implements StorageProvider {
  readonly name: StorageProviderName;
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly prefix?: string;

  constructor(config: S3CompatibleConfig) {
    if (
      config.prefix !== undefined &&
      (!isSafeStorageKey(config.prefix) || config.prefix.endsWith("/"))
    ) {
      throw new Error(
        "STORAGE_PREFIX must be a relative storage key path without a trailing slash"
      );
    }
    this.bucket = config.bucket;
    this.prefix = config.prefix;
    this.name = config.endpoint ? "do-spaces" : "s3";
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // DO Spaces requires path-style addressing; AWS S3 ignores this.
      forcePathStyle: !!config.endpoint,
    });
  }

  async createUploadUrl(args: CreateUploadUrlArgs): Promise<PresignedUpload> {
    if (!isUploadKey(args.key)) throw new StorageError("Only upload keys may be presigned", "unsafe_upload_key");
    const ttl = args.expiresInSeconds ?? DEFAULT_UPLOAD_TTL_SECONDS;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.physicalKey(args.key),
      ContentType: args.contentType,
    });
    const signingDate = args.signingDate ?? new Date(Date.now());
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttl, signingDate });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": args.contentType },
      expiresAt: new Date(signingDate.getTime() + ttl * 1000),
    };
  }

  async createDownloadUrl(args: CreateDownloadUrlArgs): Promise<string> {
    const ttl = args.expiresInSeconds ?? DEFAULT_DOWNLOAD_TTL_SECONDS;
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.physicalKey(args.key),
    });
    return getSignedUrl(this.client, cmd, { expiresIn: ttl });
  }

  async getObject(args: GetObjectArgs): Promise<StoredObject> {
    const url = await this.createDownloadUrl(args);
    return fetchStoredObject(url);
  }

  async readObjectBounded(args: ReadObjectBoundedArgs) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.physicalKey(args.key) }), { abortSignal: args.signal });
      if (!res.Body) return null;
      return await readBoundedStream(res.Body as Readable, args.maxBytes, res.ContentType ?? "application/octet-stream", args.signal);
    } catch (error) {
      const failure = boundedReadError(error, "s3");
      if (failure.code === "object_not_found") return null;
      throw failure;
    }
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.physicalKey(key),
        })
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? "application/octet-stream",
        etag: (res.ETag ?? "").replace(/^"|"$/g, ""),
      };
    } catch (err) {
      if (err instanceof NotFound || err instanceof NoSuchKey) return null;
      // S3 sometimes returns a bare 404 without typed error
      if ((err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.physicalKey(key),
      })
    );
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
    options: PutObjectOptions = {},
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.physicalKey(key),
        Body: body,
        ...(options.checksumSha256 ? { ChecksumSHA256: Buffer.from(options.checksumSha256, "hex").toString("base64") } : {}),
        ContentType: contentType,
      }),
      { abortSignal: options.signal }
    );
  }

  private physicalKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }
}
