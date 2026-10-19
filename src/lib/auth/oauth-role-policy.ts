type OAuthRolePolicy = {
  memberConnections: boolean;
  management: "organization" | "managers-only" | "personal";
};

/** Round 13 Q95/Q99 defaults. Each answer changes one setting here. */
export const OAUTH_ROLE_POLICY: OAuthRolePolicy = {
  memberConnections: true,
  management: "organization",
};

export function oauthRolePolicy(role: string, policy = OAUTH_ROLE_POLICY) {
  const manager = role === "owner" || role === "admin";
  const member = role === "member";
  return {
    connect: manager || member && policy.memberConnections,
    manageOwn: manager || member && policy.management !== "managers-only",
    manageAll: manager && policy.management !== "personal",
  };
}
