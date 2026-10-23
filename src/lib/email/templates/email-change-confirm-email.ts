import { EMAIL_VERIFICATION_EXPIRES_IN_SECONDS } from "@/config/auth";
import { composeEmail } from "./compose-email";
import { formatDuration } from "./format-duration";

/** Sent to the NEW address; `currentEmail` is the one the account uses until this is confirmed. */
export function emailChangeConfirmEmail(input: { to: string; currentEmail: string; url: string; appUrl: string }) {
  const expires = formatDuration(EMAIL_VERIFICATION_EXPIRES_IN_SECONDS);
  return composeEmail({
    subject: "Confirm your new email address for noma",
    preheader: `Confirm to sign in with this address. The link expires in ${expires}.`,
    art: "email-change",
    heading: "Confirm your new email address",
    change: { label: "Email address", from: input.currentEmail, to: input.to },
    body: [],
    action: { label: "Confirm new email address", url: input.url },
    note: `This link expires in ${expires}. Until then, keep signing in with ${input.currentEmail}.`,
    small: "If you did not ask for this change, ignore this email.",
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
