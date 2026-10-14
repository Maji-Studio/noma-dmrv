import { emptyToUndefined, refineIsometricEnvironment } from "@/config/env-validation";
import { z } from "zod";
import {
  createIsometricClient,
  ISOMETRIC_BASE_URLS,
  type IsometricClient,
} from "./client";

const optionalSecret = z.preprocess(
  emptyToUndefined,
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
