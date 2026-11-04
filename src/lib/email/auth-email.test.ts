import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./send")>()),
  sendEmail: vi.fn(),
}));
import { env } from "@/config/env";
import { sendEmail } from "./send";
import { sendAuthEmail } from "./auth-email";
import { sendOrganizationInvitation } from "./organization-invitation";

const INPUT = {
  type: "reset-password" as const, userId: "user-123", to: "recipient@example.test",
  subject: "Reset your password", html: "<p>Reset</p>", text: "Reset", url: "http://localhost:3100/reset-password/token",
};
const INVITATION = {
  invitationId: "invite-123", organizationId: "org-123", organizationName: "Org <script>",
  email: INPUT.to, role: "member", inviterName: "Amani <b>Mushi</b>",
};
const originalMode = env.NODE_ENV;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { env.NODE_ENV = originalMode; });

it("keeps a reset provider failure indistinguishable from an unknown account", async () => {
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  await expect(sendAuthEmail(INPUT)).resolves.toBeUndefined();
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(INPUT);
});

it.each(["verify-email", "email-change-confirm"] as const)("propagates a generic %s failure", async type => {
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  await expect(sendAuthEmail({ ...INPUT, type })).rejects.toThrow("Email delivery failed.");
});

it.each(["development", "test", "production"] as const)("only logs fallback links outside production (%s)", async (mode) => {
  env.NODE_ENV = mode;
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "not-configured" });
  await expect(sendAuthEmail(INPUT)).resolves.toBeUndefined();
  const result = await sendOrganizationInvitation(INVITATION);
  expect(result).toEqual({ acceptUrl: "http://localhost:3100/accept-invitation/invite-123", emailSent: false });
  if (mode === "production") expect(consoleLog).not.toHaveBeenCalled();
  else {
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(INPUT.url));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(result.acceptUrl));
  }
});

it("renders the invitation from the shared template and escapes crafted names", async () => {
  vi.mocked(sendEmail).mockResolvedValue({ sent: true, id: "message-123" });
  expect(await sendOrganizationInvitation(INVITATION)).toEqual({
    acceptUrl: "http://localhost:3100/accept-invitation/invite-123", emailSent: true,
  });
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "org-invite", to: INPUT.to,
    idempotencyKey: `org-invite/${INVITATION.invitationId}`,
    subject: "Amani <b>Mushi</b> invited you to Org <script>",
    html: expect.stringContaining("<strong style=\"font-weight:600;\">Org &lt;script&gt;</strong> as a Member."),
    text: expect.stringContaining("http://localhost:3100/accept-invitation/invite-123"),
  }));
  const { html } = vi.mocked(sendEmail).mock.calls[0]![0];
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<b>Mushi</b>");
});
