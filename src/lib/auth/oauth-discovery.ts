import { metadataResponse, oauthProviderAuthServerMetadata, type AuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { env } from "@/config/env";
import { OAUTH_DISCOVERY_CACHE_CONTROL } from "@/config/oauth";
import { auth } from "./better-auth";
import { getOAuthConfig } from "./oauth-config";
import { OAUTH_GRANTABLE_SCOPES } from "./oauth-scopes";

const DISCOVERY_HEADERS = {
  "Cache-Control": OAUTH_DISCOVERY_CACHE_CONTROL,
  "Access-Control-Allow-Origin": "*",
};

export async function oauthAuthorizationServerDiscovery(request: Request) {
  if (!env.OAUTH_PROVIDER_ENABLED) return new Response(null, { status: 404 });
  const response = await oauthProviderAuthServerMetadata(auth, { headers: DISCOVERY_HEADERS })(request);
  const metadata: AuthServerMetadata = await response.json();
  delete metadata.dpop_signing_alg_values_supported;
  // Provider extensions cannot override core fields (oauth-provider 1.7.10,
  // dist/utils-DfMNRh3J.mjs:198-209). Public preregistered clients work
  // without CIMD, so keep their auth method in the published document.
  return metadataResponse({
    ...metadata,
    token_endpoint_auth_methods_supported: [...new Set([...metadata.token_endpoint_auth_methods_supported ?? [], "none"])],
  }, DISCOVERY_HEADERS);
}

export async function oauthProtectedResourceDiscovery(audience: "mcp" | "rest") {
  if (!env.OAUTH_PROVIDER_ENABLED) return new Response(null, { status: 404 });
  const config = getOAuthConfig();
  const metadata = await oauthProviderResourceClient(auth).getActions().getProtectedResourceMetadata({
    resource: config[audience], authorization_servers: [config.issuer],
    scopes_supported: [...OAUTH_GRANTABLE_SCOPES], bearer_methods_supported: ["header"],
  });
  delete metadata.dpop_signing_alg_values_supported;
  return metadataResponse(metadata, DISCOVERY_HEADERS);
}
