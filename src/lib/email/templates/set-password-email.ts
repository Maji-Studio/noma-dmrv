import { PASSWORD_RESET_EXPIRES_IN_SECONDS } from "@/config/auth";
import { composeEmail } from "./compose-email";
import { formatDuration } from "./format-duration";

export function setPasswordEmail(input: { to: string; url: string; appUrl: string }) {
  const expires = formatDuration(PASSWORD_RESET_EXPIRES_IN_SECONDS);
  return composeEmail({
    subject: "Set your noma password",
    preheader: `Set your password to finish account setup. The link expires in ${expires}.`,
    art: "password-reset",
    heading: "Set your password",
    body: [["Choose a password to finish joining noma as ", { strong: input.to }, "."]],
    action: { label: "Choose a password", url: input.url },
    note: `This link expires in ${expires}.`,
    small: "If you did not ask for this, ignore this email.",
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
