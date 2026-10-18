import { API_KEY_LIVE_PREFIX, API_KEY_TEST_PREFIX } from "@/config/api-keys";
import { OAUTH_ACCESS_TOKEN_PREFIX } from "@/config/oauth";

export type ApiContextDenial =
  | "credential_missing" | "credential_malformed" | "credential_ambiguous"
  | "credential_header_unsupported" | "cookie_session_unsupported"
  | "credential_audience_mismatch" | "credential_invalid" | "credential_expired" | "credential_disabled"
  | "credential_revoked" | "credential_owner_removed" | "credential_owner_unverified"
  | "api_access_disabled" | "missing_scope" | "insufficient_role";

export type CredentialHeader =
  | { ok: true; key: string; kind: "api-key" | "oauth" }
  | { ok: false; denial: ApiContextDenial };

/** Cookies are ignored when a bearer is supplied; they are never an authority. */
export function parseApiCredential(headers: Headers): CredentialHeader {
  const authorization = headers.get("authorization");
  if (headers.has("x-api-key")) {
    return { ok: false, denial: authorization !== null ? "credential_ambiguous" : "credential_header_unsupported" };
  }
  if (authorization === null) {
    return { ok: false, denial: headers.has("cookie") ? "cookie_session_unsupported" : "credential_missing" };
  }
  // Headers combines duplicate Authorization fields with commas.
  if (authorization.includes(",")) return { ok: false, denial: "credential_ambiguous" };
  const match = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i.exec(authorization);
  if (!match) return { ok: false, denial: "credential_malformed" };
  const key = match[1];
  for (const prefix of [API_KEY_LIVE_PREFIX, API_KEY_TEST_PREFIX]) {
    if (key.startsWith(prefix) && key.length > prefix.length) return { ok: true, key, kind: "api-key" };
  }
  if (key.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) && key.length > OAUTH_ACCESS_TOKEN_PREFIX.length) return { ok: true, key, kind: "oauth" };
  return { ok: false, denial: "credential_invalid" };
}
