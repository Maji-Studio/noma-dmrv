// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { InvitationBootstrapForm } from "./invitation-bootstrap-form";
import { OrganizationCertifierCredentials } from "./organization-certifier-credentials";

const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), set: vi.fn() }));
vi.mock("@/fn/invitation-bootstrap", () => ({ bootstrapInvitationAccountAction: mocks.bootstrap }));
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

describe("InvitationBootstrapForm refused save", () => {
  it("keeps the issues of a failed result and marks the password field", async () => {
    mocks.bootstrap.mockResolvedValue({
      success: false, error: "Password is too weak.", code: "validation_failed",
      issues: [{ path: ["password"], code: "validation_failed", message: "Password is too weak." }],
    });
    render(<InvitationBootstrapForm invitationId="11111111-1111-4111-8111-111111111111" email="a@example.com" />);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    const password = screen.getByLabelText(/Password/);
    fireEvent.change(password, { target: { value: "longenoughpassword" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account and join" }));

    await waitFor(() => expect(document.getElementById("invite-password-error")?.textContent).toContain("Password is too weak."));
    await waitFor(() => expect(document.activeElement).toBe(password));
  });

  it("shows a result with no issues as the form error", async () => {
    mocks.bootstrap.mockResolvedValue({ success: false, error: "An account already exists for this invitation. Sign in instead." });
    render(<InvitationBootstrapForm invitationId="11111111-1111-4111-8111-111111111111" email="a@example.com" />);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "longenoughpassword" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account and join" }));
    await waitFor(() => expect(document.body.textContent).toContain("An account already exists for this invitation. Sign in instead."));
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
