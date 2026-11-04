import { composeEmail } from "./compose-email";
import { formatDateTimeUtc } from "./format-duration";

export function passwordChangedEmail(input: { to: string; changedAt: Date; resetUrl: string; appUrl: string }) {
  return composeEmail({
    subject: "Your noma password was changed",
    preheader: "If you did not change it, reset your password now.",
    art: "password-changed",
    heading: "Your password was changed",
    body: [
      ["The password for ", { strong: input.to }, ` was changed on ${formatDateTimeUtc(input.changedAt)}.`],
      ["If you did not change it, reset your password now."],
    ],
    link: { text: input.resetUrl, url: input.resetUrl },
    small: "If you made this change, you do not need to do anything.",
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
