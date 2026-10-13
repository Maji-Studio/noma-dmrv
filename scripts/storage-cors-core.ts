import type { CORSRule } from "@aws-sdk/client-s3";

const CORS_MAX_AGE_SECONDS = 300;
const PREFLIGHT_TIMEOUT_MS = 15_000;
const MAX_CORS_RULES = 100;

/** Deployments use one exact HTTPS origin, never a wildcard or a signed URL. */
export function appOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.hostname.includes("*") || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Storage CORS requires an exact HTTPS app origin");
  }
  return url.origin;
}

/** Local bucket diagnostics can run without allowing a loopback browser origin. */
export function smokeCorsOrigin(value: string, ci: boolean): string | null {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!ci && url.protocol === "http:" && loopback && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash) {
    return null;
  }
  return appOrigin(value);
}

/** Preserve other applications' rules when the bucket is shared. */
export function withUploadCorsRule(rules: CORSRule[], origin: string): CORSRule[] {
  const normalized = appOrigin(origin);
  const id = `noma-upload-${new URL(normalized).host}`;
  const others = rules.filter((rule) => rule.ID !== id);
  if (others.length >= MAX_CORS_RULES) throw new Error("Bucket CORS rule limit reached");
  return [{
    ID: id,
    AllowedOrigins: [normalized],
    AllowedMethods: ["PUT"],
    AllowedHeaders: ["Content-Type"],
    MaxAgeSeconds: CORS_MAX_AGE_SECONDS,
  }, ...others];
}

/** Node fetch does not enforce CORS; explicitly check the browser's preflight. */
export async function assertUploadCors(
  uploadUrl: string,
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const normalized = appOrigin(origin);
  let response: Response;
  try {
    response = await fetcher(uploadUrl, {
      method: "OPTIONS",
      headers: {
        Origin: normalized,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
      redirect: "error",
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
  } catch {
    // Fetch errors can contain a presigned URL. Do not propagate them.
    throw new Error("Storage CORS preflight could not reach the upload endpoint");
  }
  if (!response.ok) throw new Error(`Storage CORS preflight failed (${response.status})`);
  const allowedOrigin = response.headers.get("access-control-allow-origin");
  const methods = headerValues(response, "access-control-allow-methods");
  const headers = headerValues(response, "access-control-allow-headers");
  if ((allowedOrigin !== normalized && allowedOrigin !== "*") ||
      !methods.includes("put") || (!headers.includes("content-type") && !headers.includes("*"))) {
    throw new Error("Storage CORS does not allow the app origin to PUT with Content-Type");
  }
}

function headerValues(response: Response, name: string): string[] {
  return (response.headers.get(name) ?? "").split(",").map((value) => value.trim().toLowerCase());
}
