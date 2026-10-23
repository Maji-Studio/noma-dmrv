// @vitest-environment jsdom
/**
 * InvitationLinkNotice: shared by Settings, Members and the Platform
 * Organizations create flow. Both delivery states keep the link copyable.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationLinkNotice } from "./invitation-link-notice";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));

const URL_ = "https://app.test/accept-invitation/t";
const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe("InvitationLinkNotice", () => {
  it("confirms the email and keeps the link copyable when it was sent", async () => {
    render(<InvitationLinkNotice invitation={{ email: "amina@example.com", acceptUrl: URL_, emailSent: true }} />);

    expect(screen.getByText("Invitation emailed to amina@example.com")).toBeTruthy();
    expect(screen.queryByText(/did not send/)).toBeNull();
    expect(screen.queryByText(/send it yourself/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
    expect(toast.success).toHaveBeenCalledWith("Invitation link copied.");
  });

  it("warns that the email did not send and says the invitation is saved", async () => {
    render(<InvitationLinkNotice invitation={{ email: "amina@example.com", acceptUrl: URL_, emailSent: false }} />);

    expect(screen.getByText("The email to amina@example.com did not send")).toBeTruthy();
    expect(
      screen.getByText("The invitation is saved. Copy the link and send it another way, or check the address."),
    ).toBeTruthy();
    expect(screen.queryByText(/Invitation emailed/)).toBeNull();
    expect((screen.getByRole("textbox", { name: "Invitation link" }) as HTMLInputElement).value).toBe(URL_);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
  });

  it("resets Copied when a new invitation replaces the old one", async () => {
    const { rerender } = render(
      <InvitationLinkNotice key={URL_} invitation={{ email: "a@example.com", acceptUrl: URL_, emailSent: true }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    const next = `${URL_}2`;
    rerender(<InvitationLinkNotice key={next} invitation={{ email: "b@example.com", acceptUrl: next, emailSent: true }} />);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("tells the Admin to copy by hand when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<InvitationLinkNotice invitation={{ email: "a@example.com", acceptUrl: URL_, emailSent: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
