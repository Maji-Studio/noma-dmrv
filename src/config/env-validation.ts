import { z } from "zod";

export const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const LOCAL_APP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_APP_PROTOCOLS = new Set(["http:", "https:"]);
const HERMETIC_CI_MARKER = "true";

function isLocalAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!LOCAL_APP_PROTOCOLS.has(url.protocol)) return false;
    const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
    return LOCAL_APP_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

// Hermetic-CI exception shared by the production fail-closed gates in the
// environment schemas. ci.yml and e2e.yml compile production bundles against
// localhost with placeholder config by design (e2e.yml runs `pnpm build &&
// pnpm start` with GEO_PROVIDER=stub and no real secrets). Requiring the
// explicit marker, CI flag, and an HTTP(S) loopback URL keeps live CI workflows
// and every real deployment out of this exception.
export function isHermeticCiBuildFor(appUrl: string): boolean {
  const isCI = ["1", "true"].includes((process.env.CI ?? "").toLowerCase());
  return (
    process.env.NOMA_HERMETIC_CI === HERMETIC_CI_MARKER &&
    isCI &&
    isLocalAppUrl(appUrl)
  );
}

export const isometricClientSecretSchema = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);
export const isometricAccessTokenSchema = isometricClientSecretSchema;

export function refineIsometricCredentialPair(
  data: {
    ISOMETRIC_CLIENT_SECRET?: string;
    ISOMETRIC_ACCESS_TOKEN?: string;
  },
  ctx: z.RefinementCtx,
  issue = {
    path: ["ISOMETRIC_CLIENT_SECRET"],
    message:
      "ISOMETRIC_CLIENT_SECRET and ISOMETRIC_ACCESS_TOKEN are seed/CI-only and must either both be set or both be omitted",
  },
): void {
  if (!!data.ISOMETRIC_CLIENT_SECRET !== !!data.ISOMETRIC_ACCESS_TOKEN) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, ...issue });
  }
}

export function refineIsometricEnvironment(
  nodeEnv: string | undefined,
  appUrl: string,
  ctx: z.RefinementCtx,
): void {
  // Production fail-closed: ISOMETRIC_ENVIRONMENT defaults to "sandbox" so
  // local and CI runs need no configuration, but inheriting that default in a
  // real deployment is fail-OPEN. It both selects the registry base URL
  // (`ISOMETRIC_BASE_URLS` in isometric/client.ts) and enables the sandbox-only
  // durability measurement-sample POSTs, so an unset value would silently route
  // every registry call to the sandbox. Hermetic CI builds are excepted for
  // the reason documented on `isHermeticCiBuildFor` above.
  // Parsed schemas already carry the default, so only the raw value distinguishes
  // "explicitly sandbox" from "never set".
  if (
    nodeEnv === "production" &&
    !isHermeticCiBuildFor(appUrl) &&
    !process.env.ISOMETRIC_ENVIRONMENT
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ISOMETRIC_ENVIRONMENT"],
      message:
        "ISOMETRIC_ENVIRONMENT must be set explicitly in production (sandbox or production) - the sandbox default is not safe to inherit.",
    });
  }
}
