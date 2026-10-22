import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock("@/lib/log", () => ({ logger: { warn: mocks.warn, error: mocks.error, info: mocks.info } }));
vi.mock("@/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/env")>()),
  env: {
    RESEND_API_KEY: "synthetic", RESEND_FROM_EMAIL: "sender@example.test",
    RESEND_REPLY_TO: "support@example.test",
  },
}));

import { env } from "@/config/env";
import { sendEmail } from "./send";

const INPUT = {
  type: "org-invite" as const, invitationId: "invite-123", organizationId: "org-123",
  to: "recipient@example.test", subject: "Invitation for a private name", html: "<p>Private body</p>",
};

beforeEach(() => {
  vi.clearAllMocks();
  env.RESEND_FROM_EMAIL = "sender@example.test";
  mocks.send.mockReset().mockResolvedValue({ data: { id: "message-123" }, error: null });
});
afterEach(() => { env.RESEND_FROM_EMAIL = "sender@example.test"; });

it.each(["reset-password", "verify-email", "org-invite"] as const)("sends %s with configured from and replyTo", async (type) => {
  expect(await sendEmail({ ...INPUT, type })).toEqual({ sent: true, id: "message-123" });
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
    to: INPUT.to, subject: INPUT.subject, html: INPUT.html,
    from: env.RESEND_FROM_EMAIL, replyTo: env.RESEND_REPLY_TO,
  });
  expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ messageId: "message-123", emailType: type }), "email sent");
});

it("returns not-configured without calling Resend", async () => {
  env.RESEND_FROM_EMAIL = undefined;
  expect(await sendEmail(INPUT)).toEqual({ sent: false, reason: "not-configured" });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledOnce();
});

it.each([
  { data: null, error: { name: "validation_error", statusCode: 422, message: "recipient@example.test is invalid" } },
  { data: { id: "ignored" }, error: { name: "validation_error", statusCode: 422, message: "recipient@example.test" } },
  { data: null, error: null },
])("returns provider-error for a failed or empty SDK result: %j", async (result) => {
  mocks.send.mockResolvedValue(result);
  expect(await sendEmail(INPUT)).toEqual({ sent: false, reason: "provider-error" });
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(mocks.info).not.toHaveBeenCalled();
});

it("handles thrown exceptions without logging PII, bodies or raw error objects", async () => {
  mocks.send.mockRejectedValue(Object.assign(new Error("recipient@example.test and sender@example.test"), {
    name: "Private Name recipient@example.test", statusCode: 503,
  }));
  expect(await sendEmail(INPUT)).toEqual({ sent: false, reason: "provider-error" });
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith({
    emailType: "org-invite", invitationId: "invite-123", organizationId: "org-123",
    userId: undefined, statusCode: 503,
  }, "email provider failed");
  const logs = JSON.stringify([mocks.error.mock.calls, mocks.warn.mock.calls, mocks.info.mock.calls]);
  for (const pii of [INPUT.to, env.RESEND_FROM_EMAIL, env.RESEND_REPLY_TO, INPUT.subject, INPUT.html, "Private Name"]) {
    expect(logs).not.toContain(pii);
  }
});
