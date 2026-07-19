import { env } from "@/config/env";
import { S3CompatibleProvider, type S3CompatibleConfig } from "./s3-compatible";
import {
  LocalFsProvider,
  getOrCreateEphemeralSigningSecret,
} from "./local-fs";
import type { StorageProvider } from "./types";

let _provider: StorageProvider | null = null;

function s3ConfigFromEnv(): S3CompatibleConfig {
  const {
    STORAGE_BUCKET,
    STORAGE_REGION,
    STORAGE_ACCESS_KEY_ID,
    STORAGE_SECRET_ACCESS_KEY,
    STORAGE_ENDPOINT,
    STORAGE_PREFIX,
  } = env;
  const missing = [
    ["STORAGE_BUCKET", STORAGE_BUCKET],
    ["STORAGE_REGION", STORAGE_REGION],
    ["STORAGE_ACCESS_KEY_ID", STORAGE_ACCESS_KEY_ID],
    ["STORAGE_SECRET_ACCESS_KEY", STORAGE_SECRET_ACCESS_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `STORAGE_PROVIDER='s3-compatible' requires: ${missing.join(", ")}`
    );
  }
  return {
    bucket: STORAGE_BUCKET as string,
    region: STORAGE_REGION as string,
    endpoint: STORAGE_ENDPOINT,
    prefix: STORAGE_PREFIX,
    accessKeyId: STORAGE_ACCESS_KEY_ID as string,
    secretAccessKey: STORAGE_SECRET_ACCESS_KEY as string,
  };
}

function buildFromEnv(): StorageProvider {
  if (env.STORAGE_PROVIDER === "s3-compatible") {
    return new S3CompatibleProvider(s3ConfigFromEnv());
  }
  return new LocalFsProvider({
    root: env.STORAGE_LOCAL_FS_ROOT,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    signingSecret:
      env.STORAGE_SIGNING_SECRET ??
      env.BETTER_AUTH_SECRET ??
      getOrCreateEphemeralSigningSecret(),
  });
}

export function getStorageProvider(): StorageProvider {
  if (!_provider) _provider = buildFromEnv();
  return _provider;
}

/** @internal — for tests only */
export function __setStorageProviderForTests(p: StorageProvider | null): void {
  _provider = p;
}

export type { StorageProvider, PresignedUpload, ObjectHead } from "./types";
export { StorageError } from "./types";
export { buildStorageKey, extractExtension, isSafeStorageKey } from "./keys";
