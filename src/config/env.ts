import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * Environment variable validation schema
 * Ensures all required env vars are present and valid
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // App URL (used by Better Auth and other services)
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),

  // Email (optional for local development)
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  RESEND_FROM_EMAIL: z.preprocess(
    emptyToUndefined,
    z.string().email().optional()
  ),

  // Optional
  ALLOW_SELF_SIGNUP: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true"),
  ADMIN_EMAIL: z.string().email().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  DB_POOL_MAX: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional()
  ),
  DB_POOL_IDLE_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional()
  ),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional()
  ),

  // Isometric Certify API (optional — boot must stay clean without these)
  ISOMETRIC_CLIENT_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional()
  ),
  ISOMETRIC_ACCESS_TOKEN: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional()
  ),
  ISOMETRIC_ENVIRONMENT: z
    .enum(["sandbox", "production"])
    .optional()
    .default("sandbox"),
  // Comma-separated allowlist of host suffixes the Sources mirror flow will
  // PUT bytes to. Default covers Isometric's documented object-storage hosts,
  // including S3 regional upload host patterns. An empty list keeps the
  // default. Env-provided entries use suffix matching (`hostname.endsWith` after
  // leading-dot normalization).
  ISOMETRIC_UPLOAD_HOST_ALLOWLIST: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),

  // Object storage (Digital Ocean Spaces / AWS S3 / local-fs fallback)
  STORAGE_PROVIDER: z
    .preprocess(emptyToUndefined, z.enum(["s3-compatible", "local-fs"]).optional())
    .default("local-fs"),
  STORAGE_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  STORAGE_REGION: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  STORAGE_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  STORAGE_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  STORAGE_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  STORAGE_LOCAL_FS_ROOT: z
    .preprocess(emptyToUndefined, z.string().min(1).optional())
    .default(".storage"),
  STORAGE_SIGNING_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  NODE_ENV: z.enum(["development", "test", "production"]),
}).superRefine((data, ctx) => {
  const hasApiKey = !!data.RESEND_API_KEY;
  const hasFromEmail = !!data.RESEND_FROM_EMAIL;

  if (hasApiKey !== hasFromEmail) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RESEND_API_KEY"],
      message:
        "RESEND_API_KEY and RESEND_FROM_EMAIL must either both be set or both be omitted",
    });
  }

  const hasIsometricSecret = !!data.ISOMETRIC_CLIENT_SECRET;
  const hasIsometricToken = !!data.ISOMETRIC_ACCESS_TOKEN;

  if (hasIsometricSecret !== hasIsometricToken) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ISOMETRIC_CLIENT_SECRET"],
      message:
        "ISOMETRIC_CLIENT_SECRET and ISOMETRIC_ACCESS_TOKEN must either both be set or both be omitted",
    });
  }

  // Storage provider gates
  if (data.STORAGE_PROVIDER === "s3-compatible") {
    const missing: string[] = [];
    if (!data.STORAGE_BUCKET) missing.push("STORAGE_BUCKET");
    if (!data.STORAGE_REGION) missing.push("STORAGE_REGION");
    if (!data.STORAGE_ACCESS_KEY_ID) missing.push("STORAGE_ACCESS_KEY_ID");
    if (!data.STORAGE_SECRET_ACCESS_KEY) missing.push("STORAGE_SECRET_ACCESS_KEY");
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_PROVIDER"],
        message: `STORAGE_PROVIDER='s3-compatible' requires: ${missing.join(", ")}`,
      });
    }
  }

  // STORAGE_SIGNING_SECRET is only meaningful for local-fs (s3-compatible uses
  // AWS SigV4 from STORAGE_SECRET_ACCESS_KEY). Production rejects local-fs
  // outright (next check), so we only require the secret when explicitly using
  // local-fs in production-like environments. In dev/test it's optional and the
  // local-fs provider falls back to an ephemeral random secret with a warning.

  // Production fail-closed: never serve filesystem-backed storage in prod.
  if (data.NODE_ENV === "production" && data.STORAGE_PROVIDER !== "s3-compatible") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STORAGE_PROVIDER"],
      message:
        "STORAGE_PROVIDER must be 's3-compatible' in production. 'local-fs' is rejected as a security safeguard.",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

// Validate and export environment variables
export const env = envSchema.parse(process.env);
