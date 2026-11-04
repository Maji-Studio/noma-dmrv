// @vitest-environment jsdom
/**
 * Settings, Profile (#1277 wave 2, #1391): the name saves on its own, a new
 * email is requested by link and shown as pending, and a password change asks
 * for the current password and puts a refusal at the field it names.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { SESSION_EXPIRED } from "@/lib/domain-errors";
import { ProfileSettingsPane } from "./profile-settings-pane";

const nameMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const passwordMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const emailMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));

vi.mock("@/components/auth/sign-out-and-return", () => ({
  SignOutAndReturn: ({ children, returnTo }: { children: ReactNode; returnTo: string }) => (
    <button type="button" data-return-to={returnTo}>{children}</button>
  ),
}));
vi.mock("@/hooks/use-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-profile")>()),
  useChangeEmail: () => emailMutation,
  useUpdateProfileName: () => nameMutation,
  useChangePassword: () => passwordMutation,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const NAME = "Example Operator";
const EMAIL = "operator@example.com";
const NEW_EMAIL = /^New email/;

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  nameMutation.mutateAsync.mockResolvedValue({ name: "New Name" });
  passwordMutation.mutateAsync.mockResolvedValue({ otherDevicesSignedOut: true });
  emailMutation.mutateAsync.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("ProfileSettingsPane", () => {
  it("shows the current email as text next to a new email field", () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect(screen.queryByDisplayValue(EMAIL)).toBeNull();
    expect((screen.getByLabelText(NEW_EMAIL) as HTMLInputElement).value).toBe("");
  });

  it("asks for a link and shows the change as pending until it is opened", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type(NEW_EMAIL, "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    await waitFor(() => expect(emailMutation.mutateAsync).toHaveBeenCalledWith({ newEmail: "new@example.com" }));
    expect(
      await screen.findByText(
        "We sent a link to new@example.com. Your email changes when you open it.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect((screen.getByLabelText(NEW_EMAIL) as HTMLInputElement).value).toBe("");
  });

  it("accepts a second address after the first link was sent", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type(NEW_EMAIL, "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await screen.findByText(/We sent a link to new@example.com/);
    type(NEW_EMAIL, "other@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    await waitFor(() => expect(emailMutation.mutateAsync).toHaveBeenLastCalledWith({ newEmail: "other@example.com" }));
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
  });

  it("refuses the current address, in any case, before calling the server", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type(NEW_EMAIL, "Operator@Example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect((await screen.findAllByText("Enter an address different from your current email.")).length).toBeGreaterThan(0);
    expect(emailMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("refuses an invalid address before calling the server", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type(NEW_EMAIL, "not-an-email");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect((await screen.findAllByText("Enter a valid email address.")).length).toBeGreaterThan(0);
    expect(emailMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("asks an old session to sign out and in again", async () => {
    emailMutation.mutateAsync.mockRejectedValue(new ActionError({ code: SESSION_EXPIRED, error: "Your sign-in is too old to change your email. Sign out and sign in again, then try again." }));
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type(NEW_EMAIL, "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByText("Your sign-in is too old to change your email.")).toBeTruthy();
    expect(screen.getByText(/Sign out and sign in again, then try again\./)).toBeTruthy();
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(signOut.getAttribute("data-return-to")).toBe("/login?from=%2Fsettings%2Fprofile");
    expect(screen.queryByText(/We sent a link/)).toBeNull();
  });

  it("marks the new email field as required", () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    expect(screen.getByLabelText(NEW_EMAIL).closest("div")?.textContent).toMatch(/Required/);
  });

  it.each(["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND", "INVALID_USER"])(
    "explains a failed link (%s) and offers a new one",
    (code) => {
      render(<ProfileSettingsPane name={NAME} email={EMAIL} linkError={code} />);
      expect(screen.getByText("This link expired or was already used. Send a new one.")).toBeTruthy();
    },
  );

  it("asks to open the link again after a sign-in is required", () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} linkError="SIGN_IN_REQUIRED" />);
    expect(screen.getByText(/Open the link again now that you are signed in/)).toBeTruthy();
  });

  it("ignores an unknown link error code", () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} linkError="SOMETHING_ELSE" />);
    expect(screen.queryByText(/link expired/)).toBeNull();
    expect(screen.queryByText(/Open the link again/)).toBeNull();
  });

  it("shows the server message and wait time for other refusals", async () => {
    emailMutation.mutateAsync.mockRejectedValue(new ActionError({ error: "Too many requests. Try again in 30 seconds." }));
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type(NEW_EMAIL, "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByText("Too many requests.")).toBeTruthy();
    expect(screen.getByText("Try again in 30 seconds.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it.each([new Error(""), undefined])("uses the fallback when a refusal has no message (%s)", async error => {
    emailMutation.mutateAsync.mockRejectedValue(error);
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type(NEW_EMAIL, "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByText("Your email was not changed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("explains that the link belongs to another account", () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} linkError="WRONG_ACCOUNT" />);
    expect(screen.getByText("This link is for another account. Sign in as that account, then open the link again.")).toBeTruthy();
  });

  it("saves only the name and keeps it as the new baseline", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("Name", "New Name");
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(nameMutation.mutateAsync).toHaveBeenCalledWith({ name: "New Name" }));
    expect(passwordMutation.mutateAsync).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Name saved.");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("New Name");
  });

  it("changes the password, clears the form and says when other devices are signed out", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("Current password", "old-password");
    type("New password", "new-password");
    type("Confirm new password", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(passwordMutation.mutateAsync).toHaveBeenCalledWith({
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Password changed. Other devices are signed out within 5 minutes.");
    await waitFor(() => expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe(""));
  });

  it("says so when other devices could not be signed out", async () => {
    passwordMutation.mutateAsync.mockResolvedValue({ otherDevicesSignedOut: false });
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("Current password", "old-password");
    type("New password", "new-password");
    type("Confirm new password", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("puts a wrong current password at that field", async () => {
    const message = "That is not your current password.";
    passwordMutation.mutateAsync.mockRejectedValue(
      new ActionError({
        error: message,
        code: "validation_failed",
        issues: [{ path: ["currentPassword"], code: "validation_failed", message }],
      }),
    );
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("Current password", "wrong-password");
    type("New password", "new-password");
    type("Confirm new password", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refuses mismatched new passwords before calling the server", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("Current password", "old-password");
    type("New password", "new-password");
    type("Confirm new password", "other-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect((await screen.findAllByText("Passwords do not match")).length).toBeGreaterThan(0);
    expect(passwordMutation.mutateAsync).not.toHaveBeenCalled();
  });
});
