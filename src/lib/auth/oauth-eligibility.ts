import { isOAuthGenerationIdle } from "@/config/oauth";
import { findOAuthGenerationEligibility } from "@/data-access/oauth-credential-auth";
import { revokeGeneration } from "@/data-access/oauth-grant-lifecycle";
import { oauthRolePolicy } from "./oauth-role-policy";
import type { OrgRole } from "./server";

export type OAuthEligibilityDenial = "credential_invalid" | "credential_owner_removed" | "credential_owner_unverified" | "credential_revoked" | "credential_expired" | "api_access_disabled";
export type OAuthEligibility = { ok: true; role: OrgRole } | { ok: false; denial: OAuthEligibilityDenial };

/** Re-read live state for every caller, including callers holding an old snapshot. */
export async function assertGenerationEligible(generation: { id: string }, now: Date): Promise<OAuthEligibility> {
  const state = await findOAuthGenerationEligibility(generation.id);
  if (!state) return { ok: false, denial: "credential_invalid" };
  const { grant, member } = state;
  if (!member || !grant.memberId || member.id !== grant.memberId || !oauthRolePolicy(member.role).connect) {
    return { ok: false, denial: "credential_owner_removed" };
  }
  if (!state.emailVerified) return { ok: false, denial: "credential_owner_unverified" };
  if (grant.revokedAt) return { ok: false, denial: "credential_revoked" };
  if (isOAuthGenerationIdle(grant.lastUsedAt, now)) {
    await revokeGeneration(grant.id, "inactive");
    return { ok: false, denial: "credential_expired" };
  }
  if (state.apiEnabled === false) return { ok: false, denial: "api_access_disabled" };
  return { ok: true, role: member.role as OrgRole };
}
