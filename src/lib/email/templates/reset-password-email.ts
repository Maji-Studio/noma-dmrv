import { PASSWORD_RESET_EXPIRES_IN_SECONDS } from "@/config/auth";
import { composeEmail } from "./compose-email";
import { formatDuration } from "./format-expiry";

export function resetPasswordEmail(input: { to: string; url: string; appUrl: string }) {
  const expires = formatDuration(PASSWORD_RESET_EXPIRES_IN_SECONDS);
  return composeEmail({
    subject: "Reset your noma password",
    preheader: `Choose a new password. The link expires in ${expires}.`,
    art: "password-reset",
    heading: "Reset your password",
    body: [["We got a request to reset the password for ", { strong: input.to }, ". Use the button to choose a new one."]],
    action: { label: "Choose a new password", url: input.url },
    note: `This link expires in ${expires}.`,
    small: "If you did not ask for this, ignore this email. Your password stays the same.",
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
