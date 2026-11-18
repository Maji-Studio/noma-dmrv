// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_ADMIN_SETUP_FALLBACK } from "@/schemas/first-run";
import { SetupForm } from "./setup-form";

const mocks = vi.hoisted(() => ({ action: vi.fn(), push: vi.fn() }));
vi.mock("@/fn/first-run", () => ({ createFirstAdminAction: mocks.action }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const PASSWORD = "longenoughpassword";

function fill(email = "Admin@Example.com", confirm = PASSWORD) {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirm } });
  // Submit the form directly: jsdom would otherwise stop an invalid email before React Hook Form runs.
  fireEvent.submit(screen.getByRole("button", { name: "Create Platform Admin account" }).closest("form")!);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SetupForm", () => {
  it("shows field errors and does not call the action", async () => {
    render(<SetupForm />);
    fill("not-an-email", "different-password");
    await waitFor(() => expect(document.body.textContent).toContain("Enter a valid email address."));
    expect(document.body.textContent).toContain("Passwords do not match");
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("creates the admin and goes to the returned path", async () => {
    mocks.action.mockResolvedValue({ success: true, data: { redirectTo: "/platform/organizations" } });
    render(<SetupForm />);
    fill();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/platform/organizations"));
    expect(mocks.action).toHaveBeenCalledWith({ email: "admin@example.com", password: PASSWORD });
  });

  it("shows a refusal from the action", async () => {
    mocks.action.mockResolvedValue({ success: false, error: "noma dMRV is already set up. Sign in instead." });
    render(<SetupForm />);
    fill();
    await waitFor(() => expect(document.body.textContent).toContain("already set up"));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows the fallback when the action rejects", async () => {
    mocks.action.mockRejectedValue(new Error("Network unavailable"));
    render(<SetupForm />);
    fill();
    // ServerError splits the message into a title and a detail line.
    await waitFor(() => expect(screen.getByRole("alert").textContent?.replace(/\s+/g, " ").trim()).toBe(FIRST_ADMIN_SETUP_FALLBACK));
    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create Platform Admin account" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows the warning with a sign-in link when sign-in failed", async () => {
    mocks.action.mockResolvedValue({
      success: true,
      data: { redirectTo: "/login" },
      warning: "We couldn't sign you in automatically. Sign in with admin@example.com.",
    });
    render(<SetupForm />);
    fill();
    await waitFor(() => expect(document.body.textContent).toContain("We couldn't sign you in automatically. Sign in with admin@example.com."));
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByText("Account ready")).toBeTruthy();
    expect(screen.queryByText("Set up noma dMRV")).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("sends one request when submitted twice before the server answers", async () => {
    let finish!: (value: unknown) => void;
    mocks.action.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<SetupForm />);
    fill();
    fireEvent.submit(screen.getByRole("button", { name: "Create Platform Admin account" }).closest("form")!);
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
    finish({ success: true, data: { redirectTo: "/platform/organizations" } });
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.action).toHaveBeenCalledTimes(1);
  });
});
