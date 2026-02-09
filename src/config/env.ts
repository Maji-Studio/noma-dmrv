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
});

export type Env = z.infer<typeof envSchema>;

// Validate and export environment variables
export const env = envSchema.parse(process.env);
