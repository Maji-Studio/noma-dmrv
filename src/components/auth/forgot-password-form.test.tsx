// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form";

const mocks = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ useAuth: () => ({ requestPasswordReset: mocks.requestPasswordReset }) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

afterEach(cleanup);

it("keeps the Send reset link label and shows busy while the request is pending", async () => {
  mocks.requestPasswordReset.mockReturnValue(new Promise(() => {}));
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "someone@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalled());
  const button = screen.getByRole("button", { name: "Send reset link" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("Sending...")).toBeNull();
});
