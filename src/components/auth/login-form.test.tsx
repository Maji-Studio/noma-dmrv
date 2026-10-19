// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), push: vi.fn(), assign: vi.fn(), search: new URLSearchParams() }));
vi.mock("@/lib/auth/client", () => ({ useAuth: () => ({ signIn: mocks.signIn, resendVerification: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => mocks.search }));
vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormInput: (props: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) => { const { error, ...rest } = props; return <input {...rest} aria-invalid={error} />; },
  ServerError: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("@/components/ui", () => ({ Button: ({ children, type, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type={type} disabled={disabled}>{children}</button> }));
vi.mock("@/components/ui/notice", () => ({ Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = new URLSearchParams("from=/settings");
  vi.stubGlobal("location", { assign: mocks.assign, origin: "https://noma.test" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function submit() {
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "e2e-user@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalled());
}
it.each(["/settings", "//evil.test", "https://evil.test"])("keeps normal sign-in navigation safe for %s", async from => {
  mocks.search = new URLSearchParams({ from });
  mocks.signIn.mockResolvedValue({ success: true });
  await submit();
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(from === "/settings" ? from : "/dashboard"));
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("fully navigates to the provider continuation after OAuth sign-in", async () => {
  mocks.search = new URLSearchParams("sig=test&ba_param=client_id&client_id=app&from=/settings");
  mocks.signIn.mockResolvedValue({ success: true, redirectUrl: "/oauth/organization?signed=test" });
  await submit();
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("https://noma.test/oauth/organization?signed=test"));
  expect(mocks.push).not.toHaveBeenCalled();
});

it.each(["https://evil.test", "https://client.test/callbackx?code=a", "https://client.test/callback#code=a", "https://client.test.evil.test/callback?code=a", "https://noma.test/oauth/consent", "//evil.test", "/\\evil.test", "javascript:alert(1)", "%2f%2fevil.test"])("refuses an unsafe OAuth continuation %s", async redirectUrl => {
  mocks.search = new URLSearchParams({ sig: "test", ba_param: "redirect_uri", redirect_uri: "https://client.test/callback" });
  mocks.signIn.mockResolvedValue({ success: true, redirectUrl });
  await submit();
  await screen.findByText("Start again from the app.");
  expect(mocks.assign).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});
it.each([["https://client.test/callback", "https://client.test/callback"], ["https://client.test/callback?code=abc&state=xyz&iss=https%3A%2F%2Fnoma.test%2Fapi%2Fauth", "https://client.test/callback?code=abc&state=xyz&iss=https%3A%2F%2Fnoma.test%2Fapi%2Fauth"], ["/%2f%2fevil.test", "https://noma.test/%2f%2fevil.test"], ["/%5cevil.test", "https://noma.test/%5cevil.test"]])("allows the signed callback with response parameters, or an encoded same-origin path %s", async (redirectUrl, expected) => {
  mocks.search = new URLSearchParams({ sig: "test", ba_param: "redirect_uri", redirect_uri: "https://client.test/callback" });
  mocks.signIn.mockResolvedValue({ success: true, redirectUrl });
  await submit();
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(expected));
});
it("shows the restart message when OAuth refuses after successful authentication", async () => {
  mocks.signIn.mockResolvedValue({ success: false, error: "Start again from the app." });
  await submit();
  await screen.findByText("Start again from the app.");
  expect(screen.queryByText(/could not be signed in/)).toBeNull();
  expect(mocks.push).not.toHaveBeenCalled();
});

it("refuses a callback added outside the signed parameter list", async () => {
  mocks.search = new URLSearchParams({ sig: "test", ba_param: "client_id", redirect_uri: "https://evil.test" });
  mocks.signIn.mockResolvedValue({ success: true, redirectUrl: "https://evil.test" });
  await submit();
  await screen.findByText("Start again from the app.");
  expect(mocks.assign).not.toHaveBeenCalled();
});
