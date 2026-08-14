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

export interface GetObjectArgs {
  key: string;
  expiresInSeconds?: number;
}

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export type StorageProviderName = "s3" | "do-spaces" | "local-fs";

export interface StorageProvider {
  readonly name: StorageProviderName;
  readonly bucket: string;
  createUploadUrl(args: CreateUploadUrlArgs): Promise<PresignedUpload>;
  createDownloadUrl(args: CreateDownloadUrlArgs): Promise<string>;
  /**
   * Server-side read through a freshly presigned URL. Implementations bound
   * the transfer, reject redirects and non-success responses, and return the
   * complete object bytes with the response content type.
   */
  getObject(args: GetObjectArgs): Promise<StoredObject>;
  headObject(key: string): Promise<ObjectHead | null>;
  deleteObject(key: string): Promise<void>;
  /**
   * Server-side write of bytes already in hand — no presigned round-trip. Used
   * for objects the server generates itself (e.g. the transport evidence ledger
   * PDF) rather than receiving from a browser upload. Overwrites any existing
   * object at `key`.
   */
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "StorageError";
  }
}
