import { logLocalFallbackLink, sendEmail } from "./send";

export async function sendAuthEmail(input: {
  type: "reset-password" | "verify-email";
  userId: string;
  to: string;
  subject: string;
  html: string;
  url: string;
}): Promise<void> {
  const result = await sendEmail(input);
  logLocalFallbackLink(result, `[auth:${input.type}] userId=${input.userId} fullUrl`, input.url);
  // Reset must return the same response for existing and nonexistent accounts,
  // including when Resend is down. Verification retains failure propagation,
  // but never exposes the provider's potentially identifying error text.
  if (!result.sent && result.reason === "provider-error" && input.type === "verify-email") {
    throw new Error("Email delivery failed.");
  }
}
