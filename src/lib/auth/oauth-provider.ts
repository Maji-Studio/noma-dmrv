import { getIssuer, oauthProvider, type OAuthOptions, type Scope } from "@better-auth/oauth-provider";
import { OAUTH_ACCESS_TOKEN_PREFIX, OAUTH_REFRESH_TOKEN_PREFIX, OAUTH_ACCESS_TOKEN_SECONDS, OAUTH_CODE_SECONDS, OAUTH_REFRESH_TOKEN_SECONDS, OAUTH_PLUGIN_REPLAY_SECONDS, OAUTH_ENDPOINT_LIMITS } from "@/config/oauth";
import { OAUTH_HTTP_PATHS } from "./oauth-request-policy";
import { assertOAuthIssuer, getOAuthConfig } from "./oauth-config";
import { oauthConsentReferenceId, shouldRedirectOAuth } from "./oauth-attempt";
import { OAUTH_GRANTABLE_SCOPES } from "./oauth-scopes";
import { isPlatformAdminUser } from "@/data-access/oauth-provider";

export function createOAuthProvider() {
  const { rest, mcp } = getOAuthConfig();
  const scopes = [...OAUTH_GRANTABLE_SCOPES, "offline_access"];
  const options: OAuthOptions<Scope[]> = {
    loginPage: "/login", consentPage: "/oauth/consent",
    postLogin: { page: "/oauth/organization", shouldRedirect: shouldRedirectOAuth, consentReferenceId: oauthConsentReferenceId },
    scopes, resources: [rest, mcp], clientRegistrationDefaultResources: [mcp],
    clientRegistrationDefaultScopes: scopes, clientRegistrationAllowedScopes: scopes,
    // Only server-side registration by a Platform Admin; every other client
    // action (read, list, update, delete, rotate, client credentials) is refused.
    // The HTTP client endpoints are closed by the allowlist as well.
    clientPrivileges: async ({ action, user }) => action === "create" && !!user && await isPlatformAdminUser(user.id),
    disableJwtPlugin: true,
    grantTypes: ["authorization_code", "refresh_token"],
    prefix: { opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX, refreshToken: OAUTH_REFRESH_TOKEN_PREFIX },
    codeExpiresIn: OAUTH_CODE_SECONDS, accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_SECONDS,
    refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_SECONDS, refreshTokenReuseInterval: OAUTH_PLUGIN_REPLAY_SECONDS,
    allowDynamicClientRegistration: false,
    // Empty refuses proofs at runtime; discovery omits DPoP support.
    // Request policy and resolver also refuse sender-constrained tokens.
    dpop: { signingAlgorithms: [] },
    rateLimit: { token: OAUTH_ENDPOINT_LIMITS.token, authorize: OAUTH_ENDPOINT_LIMITS.authorize, revoke: OAUTH_ENDPOINT_LIMITS.revoke },
  };
  const plugin = oauthProvider(options);
  // Better Call checks HTTP media types before hooks.before. Close these paths
  // at request entry too, so malformed calls cannot expose a different response.
  const onRequest = plugin.onRequest;
  plugin.onRequest = async (request, context) => {
    const path = new URL(request.url).pathname.slice(new URL(context.baseURL).pathname.length);
    if (path.startsWith("/oauth2/") && !OAUTH_HTTP_PATHS.has(path)) {
      return { response: new Response(null, { status: 404 }) };
    }
    if (["/oauth2/authorize", "/oauth2/token"].includes(path) && request.method === "POST" &&
      request.headers.get("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(await request.clone().text());
      if (form.getAll("resource").length > 1) return { response: Response.json({ error: "invalid_target" }, { status: 400 }) };
    }
    return onRequest(request, context);
  };
  const init = plugin.init;
  plugin.init = async context => {
    // getIssuer reads only context.baseURL when disableJwtPlugin is true.
    assertOAuthIssuer(getIssuer({ context } as Parameters<typeof getIssuer>[0], options));
    return init(context);
  };
  return plugin;
}
