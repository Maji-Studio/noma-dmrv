import type { OrgRole } from "./server";

export const API_SCOPES = [
  "feedstocks:read", "feedstocks:write", "feedstocks:delete",
  "facilities:read", "suppliers:read", "feedstock-types:read",
  "storage-locations:read", "vehicles:read", "drivers:read",
] as const;
export type ApiScope = typeof API_SCOPES[number];
export type ApiPermissions = Record<string, string[]>;

export function toApiPermissions(scopes: readonly ApiScope[]): ApiPermissions {
  const permissions: ApiPermissions = {};
  for (const scope of new Set(scopes)) {
    const [entity, action] = scope.split(":");
    (permissions[entity] ??= []).push(action);
  }
  return permissions;
}

/** Unknown stored permissions grant nothing, including wildcards. */
export function scopesFromPermissions(permissions: ApiPermissions | null): ApiScope[] {
  return API_SCOPES.filter((scope) => {
    const [entity, action] = scope.split(":");
    return Array.isArray(permissions?.[entity]) && permissions[entity].includes(action);
  });
}

/** Better Auth stores the permissions object as JSON text. */
export function serializeApiPermissions(scopes: readonly ApiScope[]): string {
  return JSON.stringify(toApiPermissions(scopes));
}

export function scopesFromStoredPermissions(permissions: string | null): ApiScope[] {
  return scopesFromPermissions(permissions ? JSON.parse(permissions) : null);
}

export function hasScope(context: { scopes: readonly ApiScope[] }, scope: ApiScope): boolean {
  return context.scopes.includes(scope);
}

export function canOwnApiKey(role: string | null | undefined): role is "owner" | "admin" {
  return role === "owner" || role === "admin";
}

/** Operation-specific domain permissions must still be checked by the runner. */
export function hasRoleAndScope(
  context: { orgRole: OrgRole | null; scopes: readonly ApiScope[] }, scope: ApiScope,
): boolean {
  return canOwnApiKey(context.orgRole) && hasScope(context, scope);
}
