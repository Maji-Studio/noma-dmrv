import type { WalkthroughInput } from "@/schemas/walkthrough";
import { composeEmail } from "./compose-email";

export function walkthroughRequestEmail(input: WalkthroughInput & { to: string; appUrl: string }) {
  return composeEmail({
    subject: `Walkthrough request: ${input.company.replace(/[\r\n]/g, "")}`,
    preheader: "A visitor requested a noma walkthrough.",
    art: "invitation",
    heading: "Walkthrough request",
    // composeEmail's layout escapes every field with escapeHtml.
    body: [
      [{ strong: "Name: " }, input.name],
      [{ strong: "Email: " }, input.email],
      [{ strong: "Company: " }, input.company],
      [{ strong: "Size: " }, input.size],
      [{ strong: "Message: " }, input.message ?? "Not provided"],
    ],
    to: input.to,
    reason: "because a visitor submitted the noma walkthrough form.",
    appUrl: input.appUrl,
  });
}
