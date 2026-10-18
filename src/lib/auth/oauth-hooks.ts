import { defaultKeyHasher } from "@better-auth/api-key";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { OAuthRefreshToken, OAuthOpaqueAccessToken } from "@better-auth/oauth-provider";
import { OAUTH_ACCESS_TOKEN_PREFIX, OAUTH_REFRESH_TOKEN_PREFIX } from "@/config/oauth";
import { findOAuthClientResources, findOAuthClientScopes } from "@/data-access/oauth-provider";
import { revokeGeneration } from "@/data-access/oauth-grant-lifecycle";
import { assertGenerationEligible } from "./oauth-eligibility";
import { OAUTH_READ_SCOPES } from "./oauth-scopes";

const OAUTH_DEFAULT_AUTHORIZE_SCOPES: readonly string[] = [...OAUTH_READ_SCOPES, "offline_access"];
import { guardOAuthAuthorize, guardOAuthRefreshScopes, guardOAuthTokenInput, OAUTH_HTTP_PATHS, refuseOAuth, refreshDecision } from "./oauth-request-policy";

type OAuthHookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export async function oauthBefore(ctx: OAuthHookContext) {
  if (!ctx.path?.startsWith("/oauth2/")) return;
  if ((ctx.request || ctx.headers) && !OAUTH_HTTP_PATHS.has(ctx.path)) throw new APIError("NOT_FOUND");
  if (ctx.path === "/oauth2/authorize") {
    const isFormAuthorize = ctx.method === "POST" && ctx.request && new URL(ctx.request.url).pathname.endsWith("/oauth2/authorize");
    const query = (isFormAuthorize ? ctx.body : ctx.query) ?? {};
    guardOAuthAuthorize(query);
    // The raw URL preserves repeated parameters before endpoint schema parsing.
    if (ctx.request && new URL(ctx.request.url).searchParams.getAll("resource").length > 1) refuseOAuth("invalid_target");
    // No persistence: normalize before the provider signs the authorization.
    const normalized: Record<string, unknown> = { ...query };
    // Without a scope the plugin would request every client scope, writes
    // included; read first (decision 123), keeping the connection alive.
    if ((typeof query.scope !== "string" || query.scope.trim() === "") && typeof query.client_id === "string") {
      const registered = new Set(await findOAuthClientScopes(query.client_id));
      normalized.scope = OAUTH_DEFAULT_AUTHORIZE_SCOPES.filter(scope => registered.has(scope)).join(" ");
    }
    if (query.resource === undefined && typeof query.client_id === "string") {
      const resources = await findOAuthClientResources(query.client_id);
      if (resources.length !== 1) refuseOAuth("invalid_target");
      normalized.resource = resources[0].resource;
    }
    return { context: isFormAuthorize ? { body: normalized } : { query: normalized } };
  }
  if (ctx.path === "/oauth2/token") {
    const raw = ctx.body ?? {};
    // The plugin's schema trims grant_type after hooks run, so decide on the
    // trimmed value and hand that same value on: the plugin never acts on a
    // grant type this hook did not check.
    const grantType = typeof raw.grant_type === "string" ? raw.grant_type.trim() : raw.grant_type;
    if (grantType !== "authorization_code" && grantType !== "refresh_token") refuseOAuth("unsupported_grant_type");
    const body = { ...raw, grant_type: grantType };
    guardOAuthTokenInput(body, ctx.headers ?? ctx.request?.headers);
    if (body.grant_type === "authorization_code") {
      if (typeof body.code !== "string") refuseOAuth("invalid_grant");
      // Read only: consumeVerificationValue is reserved for the plugin handler.
      const code = await ctx.context.adapter.findOne<{ value: string }>({ model: "verification",
        where: [{ field: "identifier", value: await defaultKeyHasher(body.code) }] });
      // A consumed or unknown code goes to the plugin, whose replay handling
      // revokes the tokens already issued for it (RFC 6749 4.1.2).
      if (!code) return { context: { body } };
      let referenceId: unknown;
      try { referenceId = JSON.parse(code.value).referenceId; } catch { refuseOAuth("invalid_grant"); }
      if (typeof referenceId !== "string" || !(await assertGenerationEligible({ id: referenceId }, new Date())).ok) refuseOAuth("invalid_grant");
    }
    if (body.grant_type === "refresh_token") {
      const token = body.refresh_token;
      if (typeof token !== "string" || !token.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)) return { context: { body } };
      const row = await ctx.context.adapter.findOne<OAuthRefreshToken>({ model: "oauthRefreshToken",
        where: [{ field: "token", value: await defaultKeyHasher(token.slice(OAUTH_REFRESH_TOKEN_PREFIX.length)) }] });
      const now = new Date();
      // Match the plugin's strict comparison: equality must still pass our reuse guard.
      if (!row || row.expiresAt < now) return { context: { body } };
      if (!row.referenceId || !(await assertGenerationEligible({ id: row.referenceId }, now)).ok) refuseOAuth("invalid_grant");
      guardOAuthRefreshScopes(body.scope, row.scopes ?? []);
      const decision = refreshDecision({ revoked: row.revoked ?? null, rotatedAt: row.rotatedAt ?? null }, now);
      if (decision === "reuse") await revokeGeneration(row.referenceId, "refresh_reuse");
      if (decision !== "pass") refuseOAuth("invalid_grant");
    }
    return { context: { body } };
  }
  if (ctx.path === "/oauth2/revoke") {
    const token = ctx.body?.token;
    if (typeof token === "string") {
      const refresh = token.startsWith(OAUTH_REFRESH_TOKEN_PREFIX);
      const prefix = refresh ? OAUTH_REFRESH_TOKEN_PREFIX : OAUTH_ACCESS_TOKEN_PREFIX;
      if (token.startsWith(prefix)) {
        const row = await ctx.context.adapter.findOne<OAuthRefreshToken | OAuthOpaqueAccessToken>({
          model: refresh ? "oauthRefreshToken" : "oauthAccessToken",
          where: [{ field: "token", value: await defaultKeyHasher(token.slice(prefix.length)) }],
        });
        // RFC 7009 2.1: a client may only revoke its own tokens.
        if (row?.referenceId && row.clientId === ctx.body?.client_id) await revokeGeneration(row.referenceId, "client_revoked");
      }
    }
    return ctx.json({});
  }
}
