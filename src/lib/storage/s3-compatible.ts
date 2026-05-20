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
} from "./types";

const DEFAULT_UPLOAD_TTL_SECONDS = 60 * 5;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 60 * 5;

export interface S3CompatibleConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3CompatibleProvider implements StorageProvider {
  readonly name: StorageProviderName;
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: S3CompatibleConfig) {
    this.bucket = config.bucket;
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
    const ttl = args.expiresInSeconds ?? DEFAULT_UPLOAD_TTL_SECONDS;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: args.key,
      ContentType: args.contentType,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttl });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": args.contentType },
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async createDownloadUrl(args: CreateDownloadUrlArgs): Promise<string> {
    const ttl = args.expiresInSeconds ?? DEFAULT_DOWNLOAD_TTL_SECONDS;
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: args.key,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: ttl });
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
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
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }
}
