import { INVITATION_EXPIRES_IN_SECONDS } from "@/config/auth";
import { composeEmail } from "./compose-email";
import { formatDays } from "./format-duration";

/** "an Admin", "a Member". */
function withArticle(role: string): string {
  return `${/^[aeiou]/i.test(role) ? "an" : "a"} ${role}`;
}

export function invitationEmail(input: {
  to: string;
  url: string;
  appUrl: string;
  organizationName: string;
  /** Display label such as "Admin". */
  roleLabel: string;
  /** Who sent the invitation; omitted when unknown. */
  inviterName?: string;
}) {
  const { organizationName: org, inviterName: inviter } = input;
  const role = withArticle(input.roleLabel);
  const expires = formatDays(INVITATION_EXPIRES_IN_SECONDS);
  return composeEmail({
    subject: inviter ? `${inviter} invited you to ${org}` : `You are invited to join ${org}`,
    preheader: `Accept within ${expires} to join as ${role}.`,
    art: "invitation",
    heading: `Join ${org} on noma`,
    body: [
      inviter
        ? [{ strong: inviter }, " invited you to join ", { strong: org }, ` as ${role}. Accept to join.`]
        : ["You are invited to join ", { strong: org }, ` as ${role}. Accept to join.`],
    ],
    action: { label: "Accept invitation", url: input.url },
    note: `This invitation expires in ${expires}.`,
    small: "If you did not expect this invitation, ignore this email. Nothing happens until you accept.",
    to: input.to,
    reason: `because you were invited to ${org}.`,
    appUrl: input.appUrl,
  });
}
