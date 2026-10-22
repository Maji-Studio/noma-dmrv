import { composeEmail } from "./compose-email";

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
  /** Calendar date the invitation ends, such as "Oct 29, 2026". */
  expiresOn: string;
}) {
  const { organizationName: org, inviterName: inviter, expiresOn } = input;
  const role = withArticle(input.roleLabel);
  return composeEmail({
    subject: inviter ? `${inviter} invited you to ${org}` : `You are invited to join ${org}`,
    preheader: `Accept by ${expiresOn} to join as ${role}.`,
    art: "invitation",
    heading: `Join ${org} on noma`,
    body: [
      inviter
        ? [{ strong: inviter }, " invited you to join ", { strong: org }, ` as ${role}. Accept to set your name and password.`]
        : ["You are invited to join ", { strong: org }, ` as ${role}. Accept to set your name and password.`],
    ],
    action: { label: "Accept invitation", url: input.url },
    note: `This invitation expires on ${expiresOn}.`,
    small: "If you did not expect this invitation, ignore this email. Nothing happens until you accept.",
    to: input.to,
    reason: inviter ? `because ${inviter} invited you to ${org}.` : `because you were invited to ${org}.`,
    appUrl: input.appUrl,
  });
}
