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
  const intro = keys.length === 1
    ? `Your API key still works. Review or revoke it at ${developersUrl}.`
    : `Your API keys still work. Review and revoke them at ${developersUrl}.`;
  const listed = keys.slice(0, MAX_LISTED_API_KEYS).map((key): Inline[] =>
    [`${key.name || "Unnamed API key"}, created ${formatDateUtc(key.createdAt)}.`]);
  const more = keys.length - listed.length;
  return [
    [intro],
    ...listed,
    ...(more > 0 ? [[`And ${more} more.`]] : []),
  ];
}

export function passwordChangedEmail(input: { to: string; changedAt: Date; resetUrl: string; appUrl: string;
  /** null: there were no connected apps. */
  connectedAppsDisconnected?: boolean | null;
  activeApiKeys?: ApiKeyLine[] | null;
}) {
  const keyLines = apiKeyLines(input.appUrl, input.activeApiKeys);
  // Only when the email asks nothing else of the reader.
  const nothingToDo = input.connectedAppsDisconnected !== false && !keyLines.length;
  return composeEmail({
    subject: "Your noma password was changed",
    preheader: "If you did not change it, reset your password now.",
    art: "password-changed",
    heading: "Your password was changed",
    body: [
      ["The password for ", { strong: input.to }, ` was changed on ${formatDateTimeUtc(input.changedAt)}.`],
      ...(input.connectedAppsDisconnected === null ? [] : [[input.connectedAppsDisconnected
        ? "Your connected apps were disconnected. Connect them again when you need them."
        : `Connected apps could not be disconnected. Disconnect them at ${input.appUrl}${SETTINGS_CONNECTED_APPS_HREF}.`]]),
      ...keyLines,
      ["If you did not change it, reset your password now."],
    ],
    link: { text: input.resetUrl, url: input.resetUrl },
    ...(nothingToDo ? { small: "If you made this change, you do not need to do anything." } : {}),
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
