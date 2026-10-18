import type { ApiContext } from "@/lib/auth/api-context";

/** A complete API-key principal for transport tests that mock authentication. */
export function apiKeyContext(overrides: Partial<Omit<ApiContext, "principal" | "credential">> = {}): ApiContext {
  const userId = overrides.userId ?? "user";
  const credentialId = overrides.credentialId ?? "credential";
  return {
    userId, credentialId, organizationId: "org", orgRole: "admin", isPlatformAdmin: false, scopes: [],
    ...overrides,
    principal: { kind: "api-key", userId, credentialId },
    credential: { kind: "api-key", id: credentialId, name: null, expiresAt: new Date("2030-01-01T00:00:00Z") },
  };
}
