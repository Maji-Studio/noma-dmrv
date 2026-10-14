import { maskedSecretDisplay } from "@/schemas/organizations";

const CERTIFIER_ACCESS_TOKEN_SUFFIX_LENGTH = 4;

export const E2E_CERTIFIER_ACCESS_TOKEN = "e2e-org-admin-access-4321";
export const E2E_CERTIFIER_ROTATED_ACCESS_TOKEN = "e2e-org-admin-access-9876";

// Valid form input, but outside HTTP headers' ByteString range. The save
// action persists it before verification; Fetch rejects it before networking,
// so the self-service spec stays hermetic without changing the app server.
export const E2E_CERTIFIER_CLIENT_SECRET = "e2e-org-admin-client-secret-\u2603";

export function maskedCertifierAccessToken(accessToken: string): string {
  return maskedSecretDisplay(accessToken.slice(-CERTIFIER_ACCESS_TOKEN_SUFFIX_LENGTH));
}
