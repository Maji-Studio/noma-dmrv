import {
  isometricAccessTokenSchema,
  isometricClientSecretSchema,
  refineIsometricCredentialPair,
  refineIsometricEnvironment,
} from "@/config/env-validation";
import { z } from "zod";
import {
  createIsometricClient,
  ISOMETRIC_BASE_URLS,
  type IsometricClient,
} from "./client";

const clientEnvSchema = z.object({
  ISOMETRIC_CLIENT_SECRET: isometricClientSecretSchema,
  ISOMETRIC_ACCESS_TOKEN: isometricAccessTokenSchema,
  ISOMETRIC_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
}).superRefine((data, ctx) => {
  refineIsometricCredentialPair(data, ctx, {
    path: [],
    message: "ISOMETRIC_CLIENT_SECRET and ISOMETRIC_ACCESS_TOKEN must either both be set or both be omitted",
  });
  refineIsometricEnvironment(
    process.env.NODE_ENV,
    process.env.NEXT_PUBLIC_APP_URL ?? "",
    ctx,
  );
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
