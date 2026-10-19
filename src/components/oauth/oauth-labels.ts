const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function oauthRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** An app registered without a name still needs one in the copy: "this app", lowercase inside a sentence. */
export function oauthAppName(name: string | null | undefined): string {
  return name?.trim() || "this app";
}

/** The same name at the start of a sentence or as a heading. */
export function oauthAppNameStart(name: string | null | undefined): string {
  const value = oauthAppName(name);
  return value.charAt(0).toUpperCase() + value.slice(1);
}
