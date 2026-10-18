import { env } from "@/config/env";

export function deriveOAuthConfig(appUrl: string) {
  const { origin } = new URL(appUrl);
  return { issuer: `${origin}/api/auth`, rest: `${origin}/api/v1`, mcp: `${origin}/api/mcp` };
}

export function getOAuthConfig() {
  return deriveOAuthConfig(env.NEXT_PUBLIC_APP_URL);
}

/** Provider initialization calls this once c4 registers the plugin. */
export function assertOAuthIssuer(pluginIssuer: string, appUrl = env.NEXT_PUBLIC_APP_URL): void {
  if (pluginIssuer !== deriveOAuthConfig(appUrl).issuer) throw new Error("OAuth issuer does not match the configured app URL.");
}

export function oauthResourceMetadataUrl(audience: string): string {
  const config = getOAuthConfig();
  if (audience !== config.rest && audience !== config.mcp) throw new Error("Unknown OAuth audience.");
  const resource = new URL(audience);
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}
