import { composeEmail } from "./compose-email";
import { formatDateUtc } from "./format-duration";

export type OrgRoleLabel = "Admin" | "Member";

/** What each role can do, from GLOSSARY.md (Admin: full organization control; Member: day-to-day data entry). */
const ROLE_EXPLANATION: Record<OrgRoleLabel, string> = {
  Admin: "As an Admin you have full control of the organization, including its settings and members.",
  Member: "As a Member you can enter the organization's day-to-day data.",
};

export function roleChangedEmail(input: {
  to: string;
  organizationName: string;
  actorName?: string;
  fromRole: OrgRoleLabel;
  toRole: OrgRoleLabel;
  changedAt: Date;
  appUrl: string;
}) {
  const org = input.organizationName;
  const date = formatDateUtc(input.changedAt);
  const explanation = ROLE_EXPLANATION[input.toRole];
  const sentence = input.actorName
    ? [{ strong: input.actorName }, " changed your role in ", { strong: org }, ` on ${date}.`]
    : ["An Admin changed your role in ", { strong: org }, ` on ${date}.`];
  return composeEmail({
    subject: `Your role in ${org} is now ${input.toRole}`,
    preheader: `${input.actorName ?? "An Admin"} changed your role on ${date}.`,
    art: "role-changed",
    heading: "Your role changed",
    change: { label: "Role", from: input.fromRole, to: input.toRole },
    body: [explanation ? [...sentence, ` ${explanation}`] : sentence],
    small: `If you think this is a mistake, contact an Admin of ${org}.`,
    to: input.to,
    reason: `because you are a member of ${org}.`,
    appUrl: input.appUrl,
  });
}
