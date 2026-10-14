import {
  createIsometricClient,
  ISOMETRIC_BASE_URLS,
  type IsometricClient,
} from "./client";

// org-scope-ok: existing internal factory; callers authorize the organization
// before resolving its credentials, including Platform Admin verification.
export async function getIsometricClientForOrg(
  organizationId: string,
): Promise<IsometricClient> {
  const { env } = await import("@/config/env");
  const { getDecryptedCertifierCredentials } = await import(
    "@/data-access/certifier-credentials"
  );
  const credentials = await getDecryptedCertifierCredentials(
    organizationId,
    "isometric",
  );
  return createIsometricClient(
    credentials
      ? { ...credentials, baseUrl: ISOMETRIC_BASE_URLS[env.ISOMETRIC_ENVIRONMENT] }
      : null,
  );
}
