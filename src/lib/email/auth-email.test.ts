import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./send", () => ({ sendEmail: vi.fn() }));
import { env } from "@/config/env";
import { sendEmail } from "./send";
import { sendAuthEmail } from "./auth-email";
import { sendOrganizationInvitation } from "./organization-invitation";

const INPUT = {
  type: "reset-password" as const, userId: "user-123", to: "recipient@example.test",
  subject: "Reset your password", html: "<p>Reset</p>", url: "http://localhost:3100/reset-password/token",
};
const INVITATION = {
  invitationId: "invite-123", organizationId: "org-123", organizationName: "Org <script>",
  email: INPUT.to, role: "member",
};
const originalMode = env.NODE_ENV;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { env.NODE_ENV = originalMode; });

it("keeps a reset provider failure indistinguishable from an unknown account", async () => {
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  await expect(sendAuthEmail(INPUT)).resolves.toBeUndefined();
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(INPUT);
});

it("propagates a generic verification failure", async () => {
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  await expect(sendAuthEmail({ ...INPUT, type: "verify-email" })).rejects.toThrow("Email delivery failed.");
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

it("keeps invitation HTML and escapes organization names", async () => {
  vi.mocked(sendEmail).mockResolvedValue({ sent: true, id: "message-123" });
  expect(await sendOrganizationInvitation(INVITATION)).toEqual({
    acceptUrl: "http://localhost:3100/accept-invitation/invite-123", emailSent: true,
  });
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "org-invite", to: INPUT.to,
    html: expect.stringContaining("<strong>Org &lt;script&gt;</strong> as member."),
  }));
});
