// @vitest-environment jsdom
/**
 * InvitationBootstrapForm, pending invitation: reopening asks for a fresh link.
 * A refusal because the account is already set up ends in a sign-in outcome.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationBootstrapForm } from "./invitation-bootstrap-form";

const actions = vi.hoisted(() => ({
  bootstrapInvitationAccountAction: vi.fn(),
  resendInvitationSetPasswordAction: vi.fn(),
}));
vi.mock("@/fn/invitation-bootstrap", () => actions);

function renderPending() {
  render(<InvitationBootstrapForm invitationId="inv_1" email="amina@example.com" account="pending" />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("InvitationBootstrapForm resend refusals", () => {
  it("shows a sign-in outcome when the account already exists", async () => {
    actions.resendInvitationSetPasswordAction.mockResolvedValue({
      success: false,
      error: "This account is already set up.",
      code: "account_exists",
    });
    renderPending();

    expect(await screen.findByText("Account already set up")).toBeTruthy();
    expect(screen.getByText("amina@example.com already has a password. Sign in to join.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe(`/login?from=${encodeURIComponent("/accept-invitation/inv_1")}`);
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
  });

  it("keeps Send again and the reason for any other refusal", async () => {
    actions.resendInvitationSetPasswordAction.mockResolvedValue({
      success: false,
      error: "Wait a minute before asking again.",
      code: "rate_limited",
    });
    renderPending();

    await waitFor(() => expect(screen.getAllByText("Wait a minute before asking again.")).toHaveLength(1));
    expect(screen.getByText("Link not sent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy();
    expect(screen.queryByText(/for a link to set your password/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});
