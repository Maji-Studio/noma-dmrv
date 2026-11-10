// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetPasswordForm } from "./set-password-form";

const mocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("@/lib/auth/client", () => ({
  useAuth: () => ({
    resetPassword: mocks.resetPassword,
    signIn: mocks.signIn,
    getCurrentUserEmail: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const invitation = { id: "inv-1", email: "new@example.com" };
const PASSWORD = "longenoughpassword";

function fill() {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: PASSWORD } });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.params = new URLSearchParams();
});

describe("SetPasswordForm with an invitation", () => {
  it("signs in with the invited email and opens the accept page", async () => {
    mocks.params = new URLSearchParams("invitation=inv-1&token=tok");
    mocks.resetPassword.mockResolvedValue({ success: true });
    mocks.signIn.mockResolvedValue({ success: true });
    render(<SetPasswordForm invitation={invitation} />);
    expect(document.body.textContent).toContain("new@example.com");
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/accept-invitation/inv-1"));
    expect(mocks.resetPassword).toHaveBeenCalledWith("tok", PASSWORD);
    expect(mocks.signIn).toHaveBeenCalledWith("new@example.com", PASSWORD);
  });

  it("sends the person to login with a return path when sign-in fails", async () => {
    mocks.params = new URLSearchParams("invitation=inv-1&token=tok");
    mocks.resetPassword.mockResolvedValue({ success: true });
    mocks.signIn.mockResolvedValue({ success: false, error: "no" });
    render(<SetPasswordForm invitation={invitation} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/login?from=${encodeURIComponent("/accept-invitation/inv-1")}`));
  });

  it("does not sign in when the password was refused", async () => {
    mocks.params = new URLSearchParams("invitation=inv-1&token=tok");
    mocks.resetPassword.mockResolvedValue({ success: false, error: "Link expired." });
    render(<SetPasswordForm invitation={invitation} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    expect(await screen.findByRole("heading", { name: "Link no longer works" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open invitation" }).getAttribute("href")).toBe("/accept-invitation/inv-1");
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("points an expired link back to the invitation", () => {
    mocks.params = new URLSearchParams("invitation=inv-1&error=INVALID_TOKEN");
    render(<SetPasswordForm invitation={invitation} />);
    expect(screen.getByRole("heading", { name: "Link no longer works" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open invitation" }).getAttribute("href")).toBe("/accept-invitation/inv-1");
  });
});

describe("SetPasswordForm without an invitation", () => {
  it("sends the person to login after the password is set", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mocks.params = new URLSearchParams("token=tok");
    mocks.resetPassword.mockResolvedValue({ success: true });
    render(<SetPasswordForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Password set")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2100);
    expect(mocks.push).toHaveBeenCalledWith("/login");
    expect(setItem).not.toHaveBeenCalled();
    vi.useRealTimers();
    setItem.mockRestore();
  });

  it("keeps the plain flow and button label", () => {
    mocks.params = new URLSearchParams("token=tok");
    render(<SetPasswordForm />);
    expect(screen.getByRole("button", { name: "Set password" })).toBeTruthy();
  });
});
