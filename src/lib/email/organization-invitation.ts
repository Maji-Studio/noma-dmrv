import { env } from "@/config/env";
import { escapeHtml } from "./escape-html";
import { sendEmail } from "./send";

const INVITATION_IDEMPOTENCY_KEY_PREFIX = "org-invite/";

/** Call only after the authorized invitation write has committed. */
export async function sendOrganizationInvitation(input: {
  invitationId: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string;
}): Promise<{ acceptUrl: string; emailSent: boolean }> {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const acceptUrl = `${base}/accept-invitation/${input.invitationId}`;
  const result = await sendEmail({
    type: "org-invite",
    invitationId: input.invitationId,
    idempotencyKey: `${INVITATION_IDEMPOTENCY_KEY_PREFIX}${input.invitationId}`,
    organizationId: input.organizationId,
    to: input.email,
    subject: `You're invited to join ${input.organizationName}`,
    html: `
              <p>Hello,</p>
              <p>Join <strong>${escapeHtml(input.organizationName)}</strong> as ${escapeHtml(input.role)}.</p>
              <p><a href="${acceptUrl}">Accept invitation</a></p>
              <p>This invitation expires in 7 days.</p>
            `,
  });
  if (!result.sent && result.reason === "not-configured" && env.NODE_ENV !== "production") {
    console.log(`[auth:org-invite] acceptUrl=${acceptUrl}`);
  }
  return { acceptUrl, emailSent: result.sent };
}
