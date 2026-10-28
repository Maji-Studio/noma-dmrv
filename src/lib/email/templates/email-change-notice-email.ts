import { composeEmail } from "./compose-email";

/** Sent to the OLD address (`to`) when an address change is requested. */
export function emailChangeNoticeEmail(input: { to: string; newEmail: string; resetUrl: string; appUrl: string }) {
  return composeEmail({
    subject: "Your noma email address is changing",
    preheader: `A confirmation link went to ${input.newEmail}.`,
    art: "email-change",
    heading: "Your email address is changing",
    change: { label: "Email address", from: input.to, to: input.newEmail },
    body: [
      ["We sent a confirmation link to the new address. Until it is confirmed, you sign in with this one."],
      ["If you did not ask for this, reset your password now. That cancels the change."],
      ["If you can no longer sign in, reply to this email."],
    ],
    link: { text: input.resetUrl, url: input.resetUrl },
    to: input.to,
    reason: "about your noma account.",
    appUrl: input.appUrl,
  });
}
