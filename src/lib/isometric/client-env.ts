import { z } from "zod";
import {
  createIsometricClient,
  ISOMETRIC_BASE_URLS,
  type IsometricClient,
} from "./client";

const LOCAL_APP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_APP_PROTOCOLS = new Set(["http:", "https:"]);
const HERMETIC_CI_MARKER = "true";

// Match config/env.ts without loading application configuration.
function isHermeticCiBuild(): boolean {
  const isCI = ["1", "true"].includes((process.env.CI ?? "").toLowerCase());
  if (process.env.NOMA_HERMETIC_CI !== HERMETIC_CI_MARKER || !isCI) return false;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
    const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
    return LOCAL_APP_PROTOCOLS.has(url.protocol) && LOCAL_APP_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

const optionalSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);
const clientEnvSchema = z.object({
  ISOMETRIC_CLIENT_SECRET: optionalSecret,
  ISOMETRIC_ACCESS_TOKEN: optionalSecret,
  ISOMETRIC_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
}).refine(
  (value) => !!value.ISOMETRIC_CLIENT_SECRET === !!value.ISOMETRIC_ACCESS_TOKEN,
  { message: "ISOMETRIC_CLIENT_SECRET and ISOMETRIC_ACCESS_TOKEN must either both be set or both be omitted" },
).superRefine((_, ctx) => {
  if (
    process.env.NODE_ENV === "production" &&
    !isHermeticCiBuild() &&
    !process.env.ISOMETRIC_ENVIRONMENT
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ISOMETRIC_ENVIRONMENT"],
      message:
        "ISOMETRIC_ENVIRONMENT must be set explicitly in production (sandbox or production) - the sandbox default is not safe to inherit.",
    });
  }
});

/** Environment credentials are only for scripts and dedicated health checks. */
// org-scope-ok: dedicated script/health credentials, not application tenant data.
export function getIsometricClientFromEnv(): IsometricClient {
  const env = clientEnvSchema.parse(process.env);
  return createIsometricClient(
    env.ISOMETRIC_CLIENT_SECRET && env.ISOMETRIC_ACCESS_TOKEN
      ? {
          clientSecret: env.ISOMETRIC_CLIENT_SECRET,
          accessToken: env.ISOMETRIC_ACCESS_TOKEN,
          baseUrl: ISOMETRIC_BASE_URLS[env.ISOMETRIC_ENVIRONMENT],
        }
      : null,
  );
}
