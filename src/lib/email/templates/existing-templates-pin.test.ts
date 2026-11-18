import { expect, it } from "vitest";
import { invitationEmail } from "./invitation-email";
import { setPasswordEmail } from "./set-password-email";
import { resetPasswordEmail } from "./reset-password-email";
import { verifyEmailEmail } from "./verify-email-email";

/** Pins the account and invitation emails byte for byte, so layout work cannot change them. */
const APP = "https://app.noma.example";
const TO = "invitee@example.test";

const cases = {
  "set-password": () => setPasswordEmail({ to: TO, url: `${APP}/reset/tok?callbackURL=%2Fset-password`, appUrl: APP }),
  reset: () => resetPasswordEmail({ to: TO, url: `${APP}/reset/tok?a=1&b=2`, appUrl: APP }),
  verify: () => verifyEmailEmail({ to: TO, url: `${APP}/verify?token=abc.def&x=%2F`, appUrl: APP }),
  invitation: () =>
    invitationEmail({
      to: TO, url: `${APP}/accept-invitation/inv-1`, appUrl: APP, organizationName: "Dark Earth Carbon",
      roleLabel: "Admin", inviterName: "Amani Mushi",
    }),
} as const;

it.each(Object.keys(cases) as (keyof typeof cases)[])("%s html and text are unchanged", async (name) => {
  const email = cases[name]();
  await expect(email.html).toMatchFileSnapshot(`./__pins__/${name}.html`);
  await expect(email.text).toMatchFileSnapshot(`./__pins__/${name}.txt`);
  expect(email.subject.length).toBeGreaterThan(0);
});
