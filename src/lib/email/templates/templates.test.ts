import { expect, it } from "vitest";
import { formatDays, formatDuration } from "./format-duration";
import { invitationEmail } from "./invitation-email";
import { resetPasswordEmail } from "./reset-password-email";
import { verifyEmailEmail } from "./verify-email-email";

const APP = "https://app.noma.example";
const TO = "invitee@example.test";
const RESET_URL = `${APP}/api/auth/reset-password/tok?callbackURL=%2Freset-password`;
const VERIFY_URL = `${APP}/api/auth/verify-email?token=abc.def&callbackURL=%2F`;
const ACCEPT_URL = `${APP}/accept-invitation/inv-1`;
const EN_OR_EM_DASH = /[–—]/;
const CRAFTED = `<img src=x onerror="alert(1)"> & "Co"`;

const reset = resetPasswordEmail({ to: TO, url: RESET_URL, appUrl: APP });
const verify = verifyEmailEmail({ to: TO, url: VERIFY_URL, appUrl: APP });
const invite = invitationEmail({
  to: TO, url: ACCEPT_URL, appUrl: APP, organizationName: "Dark Earth Carbon", roleLabel: "Admin",
  inviterName: "Amani Mushi",
});

it.each([
  ["reset", reset, RESET_URL, "Reset your noma password"],
  ["verify", verify, VERIFY_URL, "Verify your email address for noma"],
  ["invitation", invite, ACCEPT_URL, "Amani Mushi invited you to Dark Earth Carbon"],
])("%s: subject, link in html and text, preheader, no dashes", (_name, email, url, subject) => {
  expect(email.subject).toBe(subject);
  expect(email.preheader.length).toBeGreaterThan(0);
  const htmlUrl = url.replaceAll("&", "&amp;");
  expect(email.html).toContain(`href="${htmlUrl}"`);
  expect(email.html).toContain(`>${htmlUrl}</a>`);
  expect(email.text).toContain(url);
  expect(email.html).toContain(email.preheader);
  expect(email.html).toContain("Questions? Reply to this email.");
  expect(email.text).toContain("Questions? Reply to this email.");
  expect(email.html).not.toMatch(EN_OR_EM_DASH);
  expect(email.text).not.toMatch(EN_OR_EM_DASH);
});

it("serves drawings and logo from the app origin with a dark twin", () => {
  expect(reset.html).toContain(`src="${APP}/email/logo.png"`);
  expect(reset.html).toContain(`src="${APP}/email/logo-dark.png"`);
  expect(reset.html).toContain(`src="${APP}/email/password-reset.png"`);
  expect(verify.html).toContain(`src="${APP}/email/verify-email-dark.png"`);
  expect(invite.html).toContain(`src="${APP}/email/invitation.png"`);
  expect(invitationEmail({ to: TO, url: ACCEPT_URL, appUrl: `${APP}/`, organizationName: "O", roleLabel: "Member" }).html)
    .toContain(`src="${APP}/email/logo.png"`);
});

it("names the account, not an organization, in account email footers", () => {
  for (const email of [reset, verify]) {
    expect(email.text).toContain(`Sent to ${TO} about your noma account.`);
  }
});

it("names the inviter, role and lifetime in the invitation", () => {
  expect(invite.text).toContain("Amani Mushi invited you to join Dark Earth Carbon as an Admin.");
  expect(invite.text).toContain("This invitation expires in 7 days.");
  expect(invite.html).toContain("This invitation expires in 7 days.");
  expect(invite.text).toContain("Sent to invitee@example.test because you were invited to Dark Earth Carbon.");
  expect(invite.preheader).toBe("Accept within 7 days to join as an Admin.");
  for (const body of [invite.html, invite.text]) {
    expect(body).toContain("Accept to join.");
    expect(body).not.toContain("set your name and password");
    expect(body).not.toMatch(/Oct \d|, 20\d\d/);
  }
});

it("falls back to wording without a name when the inviter is unknown", () => {
  const email = invitationEmail({
    to: TO, url: ACCEPT_URL, appUrl: APP, organizationName: "Dark Earth Carbon", roleLabel: "Member",
  });
  expect(email.subject).toBe("You are invited to join Dark Earth Carbon");
  expect(email.text).toContain("You are invited to join Dark Earth Carbon as a Member.");
  expect(email.text).toContain("because you were invited to Dark Earth Carbon.");
});

it("escapes crafted organization and inviter names in html and the preheader", () => {
  const email = invitationEmail({
    to: TO, url: ACCEPT_URL, appUrl: APP, organizationName: CRAFTED, roleLabel: "Admin", inviterName: CRAFTED,
  });
  expect(email.html).not.toContain("<img src=x");
  expect(email.html).not.toContain('onerror="alert(1)"');
  expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;Co&quot;");
  // Text is not HTML, so it carries the raw name.
  expect(email.text).toContain(CRAFTED);
});

it("escapes a crafted address in account emails", () => {
  const email = resetPasswordEmail({ to: `a"<b>@example.test`, url: RESET_URL, appUrl: APP });
  expect(email.html).not.toContain("<b>");
  expect(email.html).toContain("a&quot;&lt;b&gt;@example.test");
});

it("formats lifetimes", () => {
  expect(formatDuration(60 * 60)).toBe("1 hour");
  expect(formatDuration(60 * 60 * 24)).toBe("24 hours");
  expect(formatDuration(60 * 60 * 5)).toBe("5 hours");
  expect(formatDays(60 * 60 * 24 * 7)).toBe("7 days");
  expect(formatDays(60 * 60 * 24)).toBe("1 day");
});
