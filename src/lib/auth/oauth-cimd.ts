import { extendOAuthProvider } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { createCimdClientDiscovery } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "./oauth-cimd-transport";
import { env } from "@/config/env";
import { OAUTH_CIMD_FETCH_POLICY, OAUTH_CIMD_MAX_CACHE_ENTRIES } from "@/config/oauth";

export function createOAuthCimdPlugins() {
  if (!env.OAUTH_PROVIDER_ENABLED || env.OAUTH_CIMD_CLIENT_IDS.length === 0) return [];
  const allowed = new Set(env.OAUTH_CIMD_CLIENT_IDS);
  const discovery = createCimdClientDiscovery({
    fetchClientMetadataResource,
    isMetadataDocumentUrlAllowed: clientId => allowed.has(clientId),
    metadataProfile: "mcp-2026-07-28",
    metadataFetchPolicy: OAUTH_CIMD_FETCH_POLICY,
    maxCacheEntries: OAUTH_CIMD_MAX_CACHE_ENTRIES,
  });
  return [{
    id: "cimd",
    init(ctx) {
      extendOAuthProvider(ctx, { clientDiscovery: { ...discovery, matches: id => allowed.has(id) } });
    },
  } satisfies BetterAuthPlugin];
}
