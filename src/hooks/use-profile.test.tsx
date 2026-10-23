// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeEmailFn } from "@/fn/profile";
import { EmailChangeError, useChangeEmail } from "./use-profile";

vi.mock("@/fn/profile", () => ({ changeEmailFn: vi.fn(), changePasswordFn: vi.fn(), updateProfileNameFn: vi.fn() }));
vi.mock("@/hooks/use-organizations", () => ({ invalidateOrgMembers: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ refreshSession: vi.fn() }));

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

function emailMutation() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useChangeEmail(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  }).result;
}

const INPUT = { newEmail: "new@example.test" };

it("unwraps a successful server action", async () => {
  vi.mocked(changeEmailFn).mockResolvedValue({ success: true, data: { status: true } });
  const result = emailMutation();
  await expect(result.current.mutateAsync(INPUT)).resolves.toEqual({ status: true });
  expect(changeEmailFn).toHaveBeenCalledExactlyOnceWith(INPUT);
});

it.each([
  { code: "session_expired" as const, sessionExpired: true },
  { code: "validation_failed" as const, sessionExpired: false },
  { code: undefined, sessionExpired: false },
])("preserves EmailChangeError for action refusal $code", async ({ code, sessionExpired }) => {
  vi.mocked(changeEmailFn).mockResolvedValue({ success: false, code, error: "Safe refusal" });
  const result = emailMutation();
  const refusal = result.current.mutateAsync(INPUT);
  await expect(refusal).rejects.toBeInstanceOf(EmailChangeError);
  await expect(refusal).rejects.toMatchObject({ name: "EmailChangeError", message: "Safe refusal", sessionExpired });
});
