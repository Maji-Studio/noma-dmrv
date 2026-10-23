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
import { EmailChangeError } from "@/hooks/use-profile";
import { ProfileSettingsPane } from "./profile-settings-pane";

const nameMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const passwordMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const emailMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));

vi.mock("@/components/auth/sign-out-and-return", () => ({
  SignOutAndReturn: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
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

function type(label: string, value: string) {
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
    expect((screen.getByLabelText("New email") as HTMLInputElement).value).toBe("");
  });

  it("asks for a link and shows the change as pending until it is opened", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("New email", "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    await waitFor(() => expect(emailMutation.mutateAsync).toHaveBeenCalledWith({ newEmail: "new@example.com" }));
    expect(
      await screen.findByText(
        `We sent a link to new@example.com. Your email changes when you open it. Until then, keep signing in with ${EMAIL}.`,
      ),
    ).toBeTruthy();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect((screen.getByLabelText("New email") as HTMLInputElement).value).toBe("");
  });

  it("accepts a second address after the first link was sent", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("New email", "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await screen.findByText(/We sent a link to new@example.com/);
    type("New email", "other@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    await waitFor(() => expect(emailMutation.mutateAsync).toHaveBeenLastCalledWith({ newEmail: "other@example.com" }));
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
  });

  it("refuses the current address, in any case, before calling the server", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("New email", "Operator@Example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect((await screen.findAllByText("Enter an address different from your current email.")).length).toBeGreaterThan(0);
    expect(emailMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("refuses an invalid address before calling the server", async () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("New email", "not-an-email");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect((await screen.findAllByText("Enter a valid email address.")).length).toBeGreaterThan(0);
    expect(emailMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("asks an old session to sign out and in again", async () => {
    emailMutation.mutateAsync.mockRejectedValue(new EmailChangeError("Session expired", true));
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("New email", "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByText("Your sign-in is too old to change your email.")).toBeTruthy();
    expect(screen.getByText(/Sign out, sign in again, then retry\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByText(/We sent a link/)).toBeNull();
  });

  it("shows a generic error for any other refusal", async () => {
    emailMutation.mutateAsync.mockRejectedValue(new EmailChangeError("Too many requests", false));
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    type("New email", "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect((await screen.findAllByText("Your email was not changed.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
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
