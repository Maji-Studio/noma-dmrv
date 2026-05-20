export interface PresignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectHead {
  size: number;
  contentType: string;
  etag: string;
}

export interface CreateUploadUrlArgs {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlArgs {
  key: string;
  expiresInSeconds?: number;
}

export type StorageProviderName = "s3" | "do-spaces" | "local-fs";

export interface StorageProvider {
  readonly name: StorageProviderName;
  readonly bucket: string;
  createUploadUrl(args: CreateUploadUrlArgs): Promise<PresignedUpload>;
  createDownloadUrl(args: CreateDownloadUrlArgs): Promise<string>;
  headObject(key: string): Promise<ObjectHead | null>;
  deleteObject(key: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "StorageError";
  }
}
