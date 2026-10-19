import { permissionSummary } from "@/components/api-keys/api-key-permissions";
import { API_SCOPES, type ApiScope } from "@/lib/auth/api-scopes";

const API_SCOPE_SET: ReadonlySet<string> = new Set(API_SCOPES);

/** The API keys summary ("Feedstocks: Read, Write; Orders: Read") for a connection's scopes. */
export function connectionPermissionSummary(scopes: readonly string[]): string {
  return permissionSummary(scopes.filter((scope): scope is ApiScope => API_SCOPE_SET.has(scope)));
}

/** The host a client id identifies, when the client id is a URL. */
export function clientIdHost(clientId: string): string | null {
  try { return new URL(clientId).host || null; } catch { return null; }
}
