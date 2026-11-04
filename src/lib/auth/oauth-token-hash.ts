import { defaultKeyHasher } from "@better-auth/api-key";
import { OAUTH_ACCESS_TOKEN_PREFIX } from "@/config/oauth";

/** Both pinned plugins use Better Auth's SHA-256 / unpadded base64url hasher.
 * The provider stores only the opaque body, before adding its wire prefix.
 */
export function hashOAuthAccessToken(token: string): Promise<string> {
  if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) throw new Error("Invalid OAuth access token prefix.");
  return defaultKeyHasher(token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length));
}
