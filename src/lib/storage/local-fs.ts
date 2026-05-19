import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { readFile, rm, stat } from "fs/promises";
import path from "path";
import { isSafeStorageKey } from "./keys";
import type {
  StorageProvider,
  StorageProviderName,
  PresignedUpload,
  ObjectHead,
  CreateUploadUrlArgs,
  CreateDownloadUrlArgs,
} from "./types";
import { StorageError } from "./types";

const DEFAULT_UPLOAD_TTL_SECONDS = 60 * 5;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 60 * 5;

// Hard ceiling enforced by the local-fs route regardless of per-token cap.
export const LOCAL_FS_GLOBAL_MAX_BYTES = 100 * 1024 * 1024;

export interface LocalFsConfig {
  root: string;
  appUrl: string;
  signingSecret: string;
  globalMaxBytes?: number;
}

export interface LocalFsTokenClaims {
  k: string; // key
  m: "PUT" | "GET"; // method
  e: number; // expiry unix-ms
  c?: string; // content-type (PUT only)
  b?: number; // maxBytes (PUT only)
}

export function signLocalFsToken(
  secret: string,
  claims: LocalFsTokenClaims
): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyLocalFsToken(
  secret: string,
  token: string
): LocalFsTokenClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const macBuf = Buffer.from(mac, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (macBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;

  let claims: LocalFsTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.k !== "string" || (claims.m !== "PUT" && claims.m !== "GET")) {
    return null;
  }
  if (typeof claims.e !== "number" || claims.e < Date.now()) return null;
  return claims;
}

/**
 * Resolves an unsafe-looking key to an absolute path confined under `root`.
 * Returns null if the key escapes root or contains traversal segments.
 */
export function resolveLocalFsPath(root: string, key: string): string | null {
  if (!isSafeStorageKey(key)) return null;
  const absRoot = path.resolve(root);
  const candidate = path.resolve(absRoot, key);
  const sep = path.sep;
  if (candidate !== absRoot && !candidate.startsWith(absRoot + sep)) {
    return null;
  }
  return candidate;
}

export class LocalFsProvider implements StorageProvider {
  readonly name: StorageProviderName = "local-fs";
  readonly bucket = "local-fs";
  readonly root: string;
  readonly globalMaxBytes: number;
  private readonly appUrl: string;
  private readonly signingSecret: string;

  constructor(config: LocalFsConfig) {
    this.root = path.resolve(config.root);
    this.appUrl = config.appUrl.replace(/\/$/, "");
    this.signingSecret = config.signingSecret;
    this.globalMaxBytes = config.globalMaxBytes ?? LOCAL_FS_GLOBAL_MAX_BYTES;
  }

  async createUploadUrl(args: CreateUploadUrlArgs): Promise<PresignedUpload> {
    if (!isSafeStorageKey(args.key)) {
      throw new StorageError(`Unsafe storage key: ${args.key}`, "unsafe_key");
    }
    const cap = Math.min(args.maxBytes, this.globalMaxBytes);
    const ttl = args.expiresInSeconds ?? DEFAULT_UPLOAD_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const token = signLocalFsToken(this.signingSecret, {
      k: args.key,
      m: "PUT",
      e: expiresAt.getTime(),
      c: args.contentType,
      b: cap,
    });
    const encoded = args.key.split("/").map(encodeURIComponent).join("/");
    return {
      url: `${this.appUrl}/api/storage-local/${encoded}?token=${token}`,
      method: "PUT",
      headers: { "Content-Type": args.contentType },
      expiresAt,
    };
  }

  async createDownloadUrl(args: CreateDownloadUrlArgs): Promise<string> {
    if (!isSafeStorageKey(args.key)) {
      throw new StorageError(`Unsafe storage key: ${args.key}`, "unsafe_key");
    }
    const ttl = args.expiresInSeconds ?? DEFAULT_DOWNLOAD_TTL_SECONDS;
    const token = signLocalFsToken(this.signingSecret, {
      k: args.key,
      m: "GET",
      e: Date.now() + ttl * 1000,
    });
    const encoded = args.key.split("/").map(encodeURIComponent).join("/");
    return `${this.appUrl}/api/storage-local/${encoded}?token=${token}`;
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    const abs = resolveLocalFsPath(this.root, key);
    if (!abs) return null;
    try {
      const [s, meta] = await Promise.all([stat(abs), this.readMeta(abs)]);
      if (!s.isFile()) return null;
      return {
        size: s.size,
        contentType: meta?.contentType ?? "application/octet-stream",
        etag: `${s.mtimeMs.toString(16)}-${s.size.toString(16)}`,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const abs = resolveLocalFsPath(this.root, key);
    if (!abs) return;
    await Promise.all([
      rm(abs, { force: true }).catch(() => {}),
      rm(`${abs}.meta.json`, { force: true }).catch(() => {}),
    ]);
  }

  private async readMeta(abs: string): Promise<{ contentType: string } | null> {
    try {
      const raw = await readFile(`${abs}.meta.json`, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

let _ephemeralSecret: string | null = null;
export function getOrCreateEphemeralSigningSecret(): string {
  if (!_ephemeralSecret) {
    _ephemeralSecret = randomBytes(32).toString("base64url");
    console.warn(
      "[storage:local-fs] STORAGE_SIGNING_SECRET not set; generated an ephemeral secret. " +
        "Existing presigned URLs invalidate on each restart."
    );
  }
  return _ephemeralSecret;
}
