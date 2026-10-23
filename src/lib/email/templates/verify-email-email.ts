import { EMAIL_VERIFICATION_EXPIRES_IN_SECONDS } from "@/config/auth";
import { composeEmail } from "./compose-email";
import { formatDuration } from "./format-duration";

export function verifyEmailEmail(input: { to: string; url: string; appUrl: string }) {
  const expires = formatDuration(EMAIL_VERIFICATION_EXPIRES_IN_SECONDS);
  return composeEmail({
    subject: "Verify your email address for noma",
    preheader: `One step to finish setting up your account. The link expires in ${expires}.`,
    art: "verify-email",
    heading: "Verify your email address",
    body: [["Verify ", { strong: input.to }, " to finish setting up your noma account."]],
    action: { label: "Verify email address", url: input.url },
    note: `This link expires in ${expires}.`,
    small: "If you did not create a noma account, ignore this email.",
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
