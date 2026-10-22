// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isUnloadWarningSuppressed, suppressUnloadWarning } from "@/lib/leave-guard";
import { useCreateOrganization, useResetAfterOrgSwitch } from "./use-organizations";

const mocks = vi.hoisted(() => ({ assign: vi.fn(), create: vi.fn() }));
vi.mock("@/fn/organizations", () => ({ createOrganizationAction: mocks.create }));
vi.mock("@/fn/organization-api-access", () => ({}));
vi.mock("@/lib/read-api/client", () => ({}));

beforeEach(() => {
  vi.stubGlobal("location", { assign: mocks.assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("still lands in the new organization when storage is blocked, without throwing", () => {
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  expect(() => useResetAfterOrgSwitch()()).not.toThrow();
  expect(mocks.assign).toHaveBeenCalledWith("/dashboard");
});

it("keeps the organization intent on failure and rotates on success and new drafts", async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result, rerender, unmount } = renderHook(() => useCreateOrganization(), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  });
  const input = { name: "Test organization", adminEmail: "admin@example.test" };
  mocks.create.mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ success: false, error: "Try again" })
    .mockResolvedValue({ success: true, data: { organizationId: "org", firstAdmin: { kind: "member" } } });
  act(() => result.current.startDraft());
  await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow("Response lost"); });
  rerender();
  await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow("Try again"); });
  await act(async () => { await result.current.mutateAsync(input); });
  await act(async () => { await result.current.mutateAsync(input); });
  mocks.create.mockRejectedValue(new Error("Response lost"));
  await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow("Response lost"); });
  act(() => result.current.startDraft());
  await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow("Response lost"); });
  const keys = mocks.create.mock.calls.map(([values, options]) => {
    expect(values).toEqual(input);
    return options.intentKey;
  });
  const [initial, failedRetry, successRetry, nextDraft, abandonedDraft, restartedDraft] = keys;
  expect(initial).toEqual(expect.any(String));
  expect(failedRetry).toBe(initial);
  expect(successRetry).toBe(initial);
  expect(nextDraft).not.toBe(initial);
  expect(restartedDraft).not.toBe(abandonedDraft);
  unmount();
  client.clear();
});

it("drops the unload prompt before the hard load, so the operator is not asked twice", () => {
  mocks.assign.mockImplementation(() => {
    expect(isUnloadWarningSuppressed()).toBe(true);
  });
  useResetAfterOrgSwitch()();
  expect(mocks.assign).toHaveBeenCalledWith("/dashboard");
});

it("allows the unload prompt again after a back-forward-cache restore", () => {
  suppressUnloadWarning();
  expect(isUnloadWarningSuppressed()).toBe(true);
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
  expect(isUnloadWarningSuppressed()).toBe(true);
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
  expect(isUnloadWarningSuppressed()).toBe(false);
});
