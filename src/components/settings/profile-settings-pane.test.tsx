// @vitest-environment jsdom
/**
 * Settings, Profile (#1277 wave 2): the name saves on its own, the email is
 * shown but not editable, and a password change asks for the current password
 * and puts a refusal at the field it names.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { ProfileSettingsPane } from "./profile-settings-pane";

const nameMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const passwordMutation = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));

vi.mock("@/hooks/use-profile", () => ({
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
});
afterEach(cleanup);

describe("ProfileSettingsPane", () => {
  it("shows the email as text, not as a field", () => {
    render(<ProfileSettingsPane name={NAME} email={EMAIL} />);
    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect(screen.queryByDisplayValue(EMAIL)).toBeNull();
    expect(screen.getByText("To use another email, ask an Admin to invite that address.")).toBeTruthy();
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
