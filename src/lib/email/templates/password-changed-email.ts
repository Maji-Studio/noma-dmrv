import { SETTINGS_DEVELOPERS_HREF } from "@/lib/settings/links";
import { composeEmail } from "./compose-email";
import { formatDateTimeUtc, formatDateUtc } from "./format-duration";

export function passwordChangedEmail(input: { to: string; changedAt: Date; resetUrl: string; appUrl: string;
  connectedAppsDisconnected?: boolean;
  activeApiKeys?: { name: string | null; createdAt: Date }[] | null;
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
        : "Your password was changed, but connected apps could not be disconnected. Review them in Settings, Connected apps."],
      [input.activeApiKeys == null
        ? "Your API keys still work. The active API key list could not be loaded. Review and revoke keys in Settings, Developers."
        : input.activeApiKeys.length
          ? "Your active API keys still work. Review and revoke them in Settings, Developers:"
          : "You have no active API keys."],
      ...(input.activeApiKeys ?? []).map(key => [`${key.name || "Unnamed API key"}. Created ${formatDateUtc(key.createdAt)}.`]),
      ["If you did not change it, reset your password now."],
    ],
    link: { text: input.resetUrl, url: input.resetUrl },
    action: { label: "Settings, Developers", url: `${input.appUrl}${SETTINGS_DEVELOPERS_HREF}` },
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
