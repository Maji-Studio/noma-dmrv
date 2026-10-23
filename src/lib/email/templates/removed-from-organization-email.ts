import { composeEmail } from "./compose-email";
import { formatDateUtc } from "./format-duration";

export function removedFromOrganizationEmail(input: {
  to: string;
  organizationName: string;
  actorName?: string;
  removedAt: Date;
  appUrl: string;
}) {
  const org = input.organizationName;
  const date = formatDateUtc(input.removedAt);
  const who = input.actorName ? { strong: input.actorName } : "An Admin";
  return composeEmail({
    subject: `You were removed from ${org}`,
    preheader: `${input.actorName ?? "An Admin"} removed you on ${date}.`,
    art: "removed",
    heading: `You no longer have access to ${org}`,
    body: [
      [who, " removed you from ", { strong: org }, ` on ${date}.`],
      [`If you think this is a mistake, contact an Admin of ${org}.`],
    ],
    small: "Other organizations you belong to on noma are not affected.",
    to: input.to,
    reason: `because you were a member of ${org}.`,
    appUrl: input.appUrl,
  });
}
