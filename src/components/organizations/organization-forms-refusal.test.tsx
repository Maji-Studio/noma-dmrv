// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { InvitationBootstrapForm } from "./invitation-bootstrap-form";
import { OrganizationCertifierCredentials } from "./organization-certifier-credentials";

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), resend: vi.fn(), set: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/fn/invitation-bootstrap", () => ({ bootstrapInvitationAccountAction: mocks.bootstrap, resendInvitationSetPasswordAction: mocks.resend }));
vi.mock("@/hooks/use-busy-until-unload", () => ({ useBusyUntilUnload: () => ({ held: false, hold: vi.fn() }) }));
vi.mock("@/lib/pending-warning", () => ({ stashPendingWarning: vi.fn() }));
vi.mock("@/lib/org-switch-notice", () => ({ stashOrgSwitchNotice: vi.fn() }));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({ isLoading: false, data: { configured: false, accessTokenLast4: null } }),
  useSetOrgCertifierCredentials: () => ({ mutateAsync: mocks.set, isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const INVITATION_ID = "11111111-1111-4111-8111-111111111111";

describe("InvitationBootstrapForm", () => {
  it("keeps the issues of a failed result and marks the name field", async () => {
    mocks.bootstrap.mockResolvedValue({
      success: false, error: "Name is too long.", code: "validation_failed",
      issues: [{ path: ["name"], code: "validation_failed", message: "Name is too long." }],
    });
    render(<InvitationBootstrapForm invitationId={INVITATION_ID} email="a@example.com" />);
    const name = screen.getByLabelText(/Name/);
    expect(screen.queryByLabelText(/Password/)).toBeNull();
    fireEvent.change(name, { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));

    await waitFor(() => expect(document.getElementById("invite-name-error")?.textContent).toContain("Name is too long."));
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("shows a result with no issues as the form error", async () => {
    mocks.bootstrap.mockResolvedValue({ success: false, error: "An account already exists for this invitation. Sign in instead." });
    render(<InvitationBootstrapForm invitationId={INVITATION_ID} email="a@example.com" />);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    await waitFor(() => expect(document.body.textContent).toContain("An account already exists for this invitation. Sign in instead."));
  });

  it("switches to the check-your-email state after the name is sent", async () => {
    mocks.bootstrap.mockResolvedValue({ success: true, data: { emailSent: true } });
    render(<InvitationBootstrapForm invitationId={INVITATION_ID} email="a@example.com" />);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(await screen.findByText("Check your email")).toBeTruthy();
    expect(document.body.textContent).toContain("Open the link we sent to a@example.com");
    expect(document.body.textContent).not.toContain("We sent");
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it("asks for a fresh link once when a pending invitation is reopened", async () => {
    mocks.resend.mockResolvedValue({ success: true, data: { emailSent: true } });
    render(<InvitationBootstrapForm invitationId={INVITATION_ID} email="a@example.com" account="pending" />);
    expect(screen.getByText("Check your email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy();
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledTimes(1));
    expect(mocks.resend).toHaveBeenCalledWith({ invitationId: INVITATION_ID });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(screen.queryByText(/Link requested/)).toBeNull();
  });

  it("shows a refused on-mount resend with a way to sign in", async () => {
    mocks.resend.mockResolvedValue({ success: false, error: "An account already exists for this invitation. Sign in instead." });
    render(<InvitationBootstrapForm invitationId={INVITATION_ID} email="a@example.com" account="pending" />);
    expect(await screen.findByText("An account already exists for this invitation. Sign in instead.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(`/login?from=${encodeURIComponent(`/accept-invitation/${INVITATION_ID}`)}`);
  });

  it("sends the link again and confirms it", async () => {
    mocks.resend.mockResolvedValue({ success: true, data: { emailSent: true } });
    render(<InvitationBootstrapForm invitationId={INVITATION_ID} email="a@example.com" account="pending" />);
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith({ invitationId: INVITATION_ID }));
    expect(await screen.findByText(/Link requested/)).toBeTruthy();
  });

  it("shows a refused resend", async () => {
    mocks.resend.mockResolvedValue({ success: false, error: "An account already exists for this invitation. Sign in instead." });
    render(<InvitationBootstrapForm invitationId={INVITATION_ID} email="a@example.com" account="pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    expect(await screen.findByText("An account already exists for this invitation. Sign in instead.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});

describe("OrganizationCertifierCredentials refused save", () => {
  it("marks the access token field, lists it in the summary and focuses it", async () => {
    mocks.set.mockRejectedValue(fieldRefusal(["accessToken"], "Access token is not valid."));
    render(<OrganizationCertifierCredentials organizationId="org1" organizationName="Org" />);
    const token = document.getElementById("isometric-access-token-org1") as HTMLInputElement;
    fireEvent.change(token, { target: { value: "tok" } });
    fireEvent.change(document.getElementById("isometric-client-secret-org1")!, { target: { value: "sec" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test connection" }));

    await waitFor(() => expect(document.getElementById("isometric-access-token-org1-error")?.textContent).toContain("Access token is not valid."));
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(token));
  });

  it("keeps a refusal that names no field in the footer", async () => {
    mocks.set.mockRejectedValue(new ActionError({ error: "Keys could not be stored.", issues: [] }));
    render(<OrganizationCertifierCredentials organizationId="org1" organizationName="Org" />);
    fireEvent.change(document.getElementById("isometric-access-token-org1")!, { target: { value: "tok" } });
    fireEvent.change(document.getElementById("isometric-client-secret-org1")!, { target: { value: "sec" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test connection" }));
    expect(await screen.findByText("Keys could not be stored.")).toBeTruthy();
  });
});
