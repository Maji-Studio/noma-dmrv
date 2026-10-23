import { expect, it } from "vitest";
import { emailChangeConfirmEmail } from "./email-change-confirm-email";
import { emailChangeNoticeEmail } from "./email-change-notice-email";
import { formatDateTimeUtc, formatDateUtc } from "./format-duration";
import { passwordChangedEmail } from "./password-changed-email";
import { removedFromOrganizationEmail } from "./removed-from-organization-email";
import { roleChangedEmail } from "./role-changed-email";

const APP = "https://app.noma.example";
const TO = "invitee@example.test";
const NEW_TO = "invitee.new@example.test";
const ORG = "Dark Earth Carbon";
const RESET_URL = `${APP}/forgot-password`;
const CONFIRM_URL = `${APP}/api/auth/verify-email?token=abc.def&callbackURL=%2Fsettings%2Fprofile`;
const WHEN = new Date("2026-10-22T14:32:09Z");
const EN_OR_EM_DASH = /[–—]/;
const CRAFTED = `<img src=x onerror="alert(1)"> & "Co"`;
const CRAFTED_ESCAPED = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;Co&quot;";

const changed = passwordChangedEmail({ to: TO, changedAt: WHEN, resetUrl: RESET_URL, appUrl: APP });
const confirm = emailChangeConfirmEmail({ to: NEW_TO, currentEmail: TO, url: CONFIRM_URL, appUrl: APP });
const notice = emailChangeNoticeEmail({ to: TO, newEmail: NEW_TO, resetUrl: RESET_URL, appUrl: APP });
const role = roleChangedEmail({
  to: TO, organizationName: ORG, actorName: "Amani Mushi", fromRole: "Member", toRole: "Admin", changedAt: WHEN, appUrl: APP,
});
const removed = removedFromOrganizationEmail({
  to: TO, organizationName: ORG, actorName: "Amani Mushi", removedAt: WHEN, appUrl: APP,
});

it("formats dates in UTC", () => {
  expect(formatDateUtc(WHEN)).toBe("Oct 22, 2026");
  expect(formatDateTimeUtc(WHEN)).toBe("Oct 22, 2026 at 14:32 UTC");
  expect(formatDateTimeUtc(new Date("2026-01-05T03:07:00Z"))).toBe("Jan 5, 2026 at 03:07 UTC");
});

it.each([
  ["password changed", changed],
  ["email change confirm", confirm],
  ["email change notice", notice],
  ["role changed", role],
  ["removed", removed],
])("%s: no dashes, footer, preheader in html", (_name, email) => {
  expect(email.html).not.toMatch(EN_OR_EM_DASH);
  expect(email.text).not.toMatch(EN_OR_EM_DASH);
  expect(email.html).toContain(email.preheader);
  expect(email.text).toContain("Questions? Reply to this email.");
});

it("password changed: names the account and time, links to reset, no organization", () => {
  expect(changed.subject).toBe("Your noma password was changed");
  expect(changed.preheader).toBe("If you did not change it, reset your password now.");
  expect(changed.text).toContain(`The password for ${TO} was changed on Oct 22, 2026 at 14:32 UTC.`);
  expect(changed.text).toContain(`If you did not change it, reset your password now.\n${RESET_URL}\n`);
  expect(changed.text).toContain("If you made this change, you do not need to do anything.");
  expect(changed.text).toContain(`Sent to ${TO} about your noma account.`);
  expect(changed.html).toContain(`href="${RESET_URL}"`);
  expect(changed.html).toContain(`src="${APP}/email/password-changed.png"`);
  expect(changed.html).not.toContain("Confirm");
  expect(changed.html).not.toContain("If the button does not work");
});

it("email change confirm: before to after, 24 hours, current address, button", () => {
  expect(confirm.subject).toBe("Confirm your new email address for noma");
  expect(confirm.text).toContain(`Email address: ${TO} → ${NEW_TO}`);
  expect(confirm.text).toContain(`Confirm new email address:\n${CONFIRM_URL}`);
  expect(confirm.text).toContain(`This link expires in 24 hours. Until then, keep signing in with ${TO}.`);
  expect(confirm.preheader).toBe("Confirm to sign in with this address. The link expires in 24 hours.");
  expect(confirm.text).toContain(`Sent to ${NEW_TO} about your noma account.`);
  expect(confirm.html).toContain("&rarr;");
  expect(confirm.html).toContain(`href="${CONFIRM_URL.replaceAll("&", "&amp;")}"`);
});

it("email change notice: goes to the old address, points at the new one and reset", () => {
  expect(notice.subject).toBe("Your noma email address is changing");
  expect(notice.text).toContain(`Email address: ${TO} → ${NEW_TO}`);
  expect(notice.text).toContain("Until it is confirmed, you sign in with this one.");
  expect(notice.text).toContain(`If you did not ask for this, reset your password now.\n${RESET_URL}\n`);
  expect(notice.text).toContain(`Sent to ${TO} about your noma account.`);
  expect(notice.preheader).toBe(`A confirmation link went to ${NEW_TO}.`);
  expect(notice.html).not.toContain("<a href=\"\"");
});

it("role changed: subject, before to after, role explanation, names the organization", () => {
  expect(role.subject).toBe(`Your role in ${ORG} is now Admin`);
  expect(role.text).toContain("Role: Member → Admin");
  expect(role.text).toContain(`Amani Mushi changed your role in ${ORG} on Oct 22, 2026. As an Admin you have full control`);
  expect(role.text).toContain(`If you think this is a mistake, contact an Admin of ${ORG}.`);
  expect(role.text).toContain(`Sent to ${TO} because you are a member of ${ORG}.`);
  const member = roleChangedEmail({
    to: TO, organizationName: ORG, fromRole: "Admin", toRole: "Member", changedAt: WHEN, appUrl: APP,
  });
  expect(member.subject).toBe(`Your role in ${ORG} is now Member`);
  expect(member.text).toContain(`An Admin changed your role in ${ORG} on Oct 22, 2026. As a Member you can`);
  expect(member.text).toContain("Role: Admin → Member");
});

it("removed: subject, access sentence, mistake line, other organizations note", () => {
  expect(removed.subject).toBe(`You were removed from ${ORG}`);
  expect(removed.text).toContain(`You no longer have access to ${ORG}`);
  expect(removed.text).toContain(`Amani Mushi removed you from ${ORG} on Oct 22, 2026.`);
  expect(removed.text).toContain(`If you think this is a mistake, contact an Admin of ${ORG}.`);
  expect(removed.text).toContain("Other organizations you belong to on noma are not affected.");
  expect(removed.text).toContain(`Sent to ${TO} because you were a member of ${ORG}.`);
  const anonymous = removedFromOrganizationEmail({ to: TO, organizationName: ORG, removedAt: WHEN, appUrl: APP });
  expect(anonymous.text).toContain(`An Admin removed you from ${ORG} on Oct 22, 2026.`);
  expect(anonymous.preheader).toBe("An Admin removed you on Oct 22, 2026.");
});

it("account emails name no organization", () => {
  for (const email of [changed, confirm, notice]) {
    expect(email.html).not.toContain(ORG);
    expect(email.text).not.toContain(ORG);
    expect(email.text).not.toMatch(/Admin of/);
  }
});

it("escapes crafted organization and actor names in html, raw in text", () => {
  const emails = [
    roleChangedEmail({
      to: TO, organizationName: CRAFTED, actorName: CRAFTED, fromRole: "Member", toRole: "Admin", changedAt: WHEN, appUrl: APP,
    }),
    removedFromOrganizationEmail({ to: TO, organizationName: CRAFTED, actorName: CRAFTED, removedAt: WHEN, appUrl: APP }),
  ];
  for (const email of emails) {
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain('onerror="alert(1)"');
    expect(email.html).toContain(CRAFTED_ESCAPED);
    expect(email.text).toContain(CRAFTED);
  }
});

it("escapes crafted addresses in the before and after block", () => {
  const email = emailChangeConfirmEmail({ to: `a"<b>@example.test`, currentEmail: `c<i>@example.test`, url: CONFIRM_URL, appUrl: APP });
  expect(email.html).not.toContain("<b>");
  expect(email.html).not.toContain("<i>");
  expect(email.html).toContain("a&quot;&lt;b&gt;@");
});
