/**
 * Render the transactional email templates with example data for review.
 * Usage: pnpm tsx scripts/render-email-previews.ts <outDir> [imageBaseUrl]
 * Writes <name>.html and <name>.txt per email. By default images load from
 * public/email on disk, so the files open offline in a browser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { invitationEmail } from "../src/lib/email/templates/invitation-email";
import { resetPasswordEmail } from "../src/lib/email/templates/reset-password-email";
import { verifyEmailEmail } from "../src/lib/email/templates/verify-email-email";

const APP_URL = "https://app.noma.maji.studio";
const TO = "invitee@example.com";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: pnpm tsx scripts/render-email-previews.ts <outDir> [imageBaseUrl]");
  process.exit(1);
}
const appUrl = process.argv[3] ?? pathToFileURL(resolve("public")).href;

const emails = {
  invitation: invitationEmail({
    to: TO, url: `${APP_URL}/accept-invitation/Jx4nQ8wR2kLmV7pTz9cY`, appUrl,
    organizationName: "Dark Earth Carbon", roleLabel: "Admin", inviterName: "Amani Mushi",
  }),
  "invitation-no-inviter": invitationEmail({
    to: TO, url: `${APP_URL}/accept-invitation/Jx4nQ8wR2kLmV7pTz9cY`, appUrl,
    organizationName: "Dark Earth Carbon", roleLabel: "Member",
  }),
  "password-reset": resetPasswordEmail({
    to: TO, appUrl, url: `${APP_URL}/api/auth/reset-password/9fK2mQ7xL4pR8vT1bN6s?callbackURL=%2Freset-password`,
  }),
  "verify-email": verifyEmailEmail({
    to: TO, appUrl, url: `${APP_URL}/api/auth/verify-email?token=eyJhbGciOiJIUzI1NiJ9.k3Qm8ZpX&callbackURL=%2F`,
  }),
};

mkdirSync(outDir, { recursive: true });
for (const [name, email] of Object.entries(emails)) {
  writeFileSync(join(outDir, `${name}.html`), email.html);
  writeFileSync(join(outDir, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}`);
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ subject: email.subject, preheader: email.preheader }));
}
