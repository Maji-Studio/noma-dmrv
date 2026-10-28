import type { OrgRole } from "@/lib/auth/server";
import { orgRoleLabel } from "@/lib/org-role-label";
import { getEmailAppUrl } from "./app-url";
import { invitationEmail } from "./templates/invitation-email";
import { logLocalFallbackLink, sendEmail } from "./send";

const INVITATION_IDEMPOTENCY_KEY_PREFIX = "org-invite/";

/** Call only after the authorized invitation write has committed. */
export async function sendOrganizationInvitation(input: {
  invitationId: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string;
  /** Name of whoever sent the invitation; wording drops it when unknown. */
  inviterName?: string | null;
}): Promise<{ acceptUrl: string; emailSent: boolean }> {
  const base = getEmailAppUrl();
  const acceptUrl = `${base}/accept-invitation/${input.invitationId}`;
  const { subject, html, text } = invitationEmail({
    to: input.email,
    url: acceptUrl,
    appUrl: base,
    organizationName: input.organizationName,
    roleLabel: orgRoleLabel(input.role as OrgRole) ?? input.role,
    inviterName: input.inviterName?.trim() || undefined,
  });
  const result = await sendEmail({
    type: "org-invite",
    invitationId: input.invitationId,
    idempotencyKey: `${INVITATION_IDEMPOTENCY_KEY_PREFIX}${input.invitationId}`,
    organizationId: input.organizationId,
    to: input.email,
    subject,
    html,
    text,
  });
  logLocalFallbackLink(result, "[auth:org-invite] acceptUrl", acceptUrl);
  return { acceptUrl, emailSent: result.sent };
}
