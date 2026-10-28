// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { useQuickAddSubmit } from "./use-quick-add-submit";

afterEach(cleanup);

it("keeps failures on one key and rotates before success callbacks and for a new draft", async () => {
  const uuid = vi.spyOn(crypto, "randomUUID");
  const client = new QueryClient();
  const entity = { id: "one", code: "V-1", name: "Vehicle" };
  const serverFn = vi.fn().mockResolvedValueOnce({ success: false, error: "Save again" })
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({ success: true, data: entity });
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  const { result, rerender } = renderHook(() => useQuickAddSubmit({ entityType: "vehicle", serverFn, onSuccess, onClose }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  const submit = () => act(async () => { await result.current.handleSubmit({ name: "Vehicle" }); });
  await submit();
  expect(result.current.error).toBe("Save again");
  rerender();
  await submit();
  expect(result.current.error).toBe("Response lost");
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  await submit();
  expect(result.current.error).toBeNull();
  expect(result.current.isSubmitting).toBe(false);
  expect(onSuccess).toHaveBeenCalledWith(entity);
  expect(uuid.mock.invocationCallOrder[1]).toBeLessThan(onSuccess.mock.invocationCallOrder[0]);
  await submit();
  const keys = () => serverFn.mock.calls.map(([, key]) => key);
  expect(keys()[0]).toEqual(expect.any(String));
  expect(keys()[1]).toBe(keys()[0]);
  expect(keys()[2]).toBe(keys()[0]);
  expect(keys()[3]).not.toBe(keys()[0]);
  serverFn.mockResolvedValue({ success: false, error: "Save again" });
  await submit();
  act(() => result.current.startDraft());
  await submit();
  expect(keys()[5]).not.toBe(keys()[4]);
  client.clear();
});

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const refusal = {
  success: false as const,
  error: "Name is taken",
  code: "validation_failed" as const,
  issues: [{ path: ["name"], code: "validation_failed" as const, message: "Name is taken" }],
};

it("keeps the footer message of a form that passes no refusal handler", async () => {
  const serverFn = vi.fn().mockResolvedValue(refusal);
  const { result } = renderHook(() => useQuickAddSubmit({ entityType: "vehicle", serverFn, onSuccess: vi.fn(), onClose: vi.fn() }), { wrapper });
  await act(async () => { await result.current.handleSubmit({ name: "Vehicle" }); });
  expect(result.current.error).toBe("Name is taken");
});

it("hands a refusal to the form's handler as an ActionError and shows what it returns", async () => {
  const serverFn = vi.fn().mockResolvedValue(refusal);
  const onRefusal = vi.fn().mockReturnValue(null);
  const { result } = renderHook(() => useQuickAddSubmit({ entityType: "vehicle", serverFn, onSuccess: vi.fn(), onClose: vi.fn() }), { wrapper });
  await act(async () => { await result.current.handleSubmit({ name: "Vehicle" }, onRefusal); });
  const [error, fallback] = onRefusal.mock.calls[0];
  expect(error).toBeInstanceOf(ActionError);
  expect(error.issues).toEqual(refusal.issues);
  expect(fallback).toBe("Name is taken");
  expect(result.current.error).toBeNull();
  onRefusal.mockReturnValue("Locked footer");
  await act(async () => { await result.current.handleSubmit({ name: "Vehicle" }, onRefusal); });
  expect(result.current.error).toBe("Locked footer");
});
