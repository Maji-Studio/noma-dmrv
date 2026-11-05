import { SETTINGS_CONNECTED_APPS_HREF, SETTINGS_DEVELOPERS_HREF } from "@/lib/settings/links";
import { composeEmail } from "./compose-email";
import type { Inline } from "./email-content";
import { formatDateTimeUtc, formatDateUtc } from "./format-duration";

/** Keep the reset instruction near the top for people with many keys. */
const MAX_LISTED_API_KEYS = 10;

type ApiKeyLine = { name: string | null; createdAt: Date };

function apiKeyLines(appUrl: string, keys: ApiKeyLine[] | null | undefined): Inline[][] {
  const developersUrl = `${appUrl}${SETTINGS_DEVELOPERS_HREF}`;
  if (keys == null) return [[`Your API keys still work. Review and revoke them at ${developersUrl}.`]];
  if (!keys.length) return [];
  const listed = keys.slice(0, MAX_LISTED_API_KEYS).map((key): Inline[] =>
    [`${key.name || "Unnamed API key"}, created ${formatDateUtc(key.createdAt)}.`]);
  const more = keys.length - listed.length;
  return [
    [`Your API keys still work. Review and revoke them at ${developersUrl}.`],
    ...listed,
    ...(more > 0 ? [[`And ${more} more.`]] : []),
  ];
}

export function passwordChangedEmail(input: { to: string; changedAt: Date; resetUrl: string; appUrl: string;
  connectedAppsDisconnected?: boolean;
  activeApiKeys?: ApiKeyLine[] | null;
}) {
  return composeEmail({
    subject: "Your noma password was changed",
    preheader: "If you did not change it, reset your password now.",
    art: "password-changed",
    heading: "Your password was changed",
    body: [
      ["The password for ", { strong: input.to }, ` was changed on ${formatDateTimeUtc(input.changedAt)}.`],
      [input.connectedAppsDisconnected
        ? "Your connected apps were disconnected. Connect them again when you need them."
        : `Connected apps could not be disconnected. Disconnect them at ${input.appUrl}${SETTINGS_CONNECTED_APPS_HREF}.`],
      ...apiKeyLines(input.appUrl, input.activeApiKeys),
      ["If you did not change it, reset your password now."],
    ],
    link: { text: input.resetUrl, url: input.resetUrl },
    small: "If you made this change, you do not need to do anything.",
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
