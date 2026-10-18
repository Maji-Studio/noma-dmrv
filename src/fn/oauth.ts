"use server";

import { getOAuthOrganizationSelection, selectOAuthOrganization, resolveAttemptGrant } from "@/data-access/oauth-grant-lifecycle";
import { getOAuthAttemptConsent } from "@/data-access/oauth-provider";
import { listOwnOAuthGrants, listAllOAuthGrants, revokeOAuthGrant } from "@/data-access/oauth-grants";
import { assertGenerationEligible } from "@/lib/auth/oauth-eligibility";
import { parseOAuthScopes } from "@/lib/auth/oauth-scopes";
import { oauthRolePolicy } from "@/lib/auth/oauth-role-policy";
import { oauthQuerySchema, selectOAuthOrganizationSchema, revokeOAuthGrantSchema } from "@/schemas/oauth";
import { withAction } from "./with-action";
import { withOAuthSession, verifiedOAuthRequest, refuseOAuthAction } from "./oauth-session";

export async function getOAuthOrganizationChoicesFn(input: unknown) {
  return withOAuthSession(async () => {
    const { attempt, display } = await verifiedOAuthRequest(oauthQuerySchema.parse(input).oauthQuery);
    const selection = await getOAuthOrganizationSelection(attempt);
    return { ...display, memberships: selection.memberships.map(({ organizationId, name, role, disabledReason }) =>
      ({ organizationId, name, role, disabledReason })), preselectedOrganizationId: selection.preselectedOrganizationId };
  });
}

export async function selectOAuthOrganizationFn(input: unknown) {
  return withOAuthSession(async () => {
    const { oauthQuery, organizationId } = selectOAuthOrganizationSchema.parse(input);
    const { attempt } = await verifiedOAuthRequest(oauthQuery);
    await selectOAuthOrganization({ ...attempt, organizationId });
    return { oauth_query: oauthQuery, postLogin: true as const };
  });
}

export async function getOAuthConsentViewFn(input: unknown) {
  return withOAuthSession(async () => {
    const { attempt, query, display } = await verifiedOAuthRequest(oauthQuerySchema.parse(input).oauthQuery);
    if (query.get("ba_pl") !== attempt.sessionId) refuseOAuthAction();
    const grant = await resolveAttemptGrant(attempt);
    if (!(await assertGenerationEligible(grant, new Date())).ok) refuseOAuthAction();
    const view = await getOAuthAttemptConsent(attempt);
    if (!view) refuseOAuthAction();
    const requested = parseOAuthScopes(query.get("scope") ?? "");
    const apiScopes = requested.filter(scope => scope !== "offline_access");
    if (!apiScopes.length) refuseOAuthAction();
    const allowed = new Set(view.consentScopes ?? []);
    const newlyRequestedScopes = apiScopes.filter(scope => !allowed.has(scope));
    return { ...display, organization: { id: view.organizationId, name: view.name },
      newlyRequestedScopes,
      alreadyAllowedScopes: apiScopes.filter(scope => allowed.has(scope)),
      offlineAccessRequested: requested.includes("offline_access"), isStepUp: view.consentScopes !== null && newlyRequestedScopes.length > 0 };
  });
}

export async function listOAuthGrantsFn() {
  return withAction(ctx => oauthRolePolicy(ctx.orgRole ?? "").manageAll ? listAllOAuthGrants(ctx) : listOwnOAuthGrants(ctx));
}

export async function revokeOAuthGrantFn(input: unknown) {
  return withAction(ctx => revokeOAuthGrant(ctx, revokeOAuthGrantSchema.parse(input)));
}
