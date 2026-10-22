// @vitest-environment jsdom
/** A failed stock or application save refreshes the credit batch previews planned on that stock (#1350). */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { useCreateApplication, useUpdateApplication } from "./use-applications";
import { invalidateAfterFailedStockSave, outputStockKeys, usePostOutputStock } from "./use-output-stock";

const { post, createApplication, updateApplication } = vi.hoisted(() => ({ post: vi.fn(), createApplication: vi.fn(), updateApplication: vi.fn() }));
vi.mock("@/fn/output-stock", () => ({ postOutputStockFn: post }));
vi.mock("@/fn/applications", () => ({
  getApplicationsFn: vi.fn(), getApplicationDeliveryOptionsFn: vi.fn(),
  createApplicationFn: createApplication, updateApplicationFn: updateApplication, deleteApplicationFn: vi.fn(),
}));

const PREVIEW_INPUT = {
  kind: "delivery" as const,
  bin: { storageLocationId: "bin", facilityId: "fac", occurredAt: "2026-10-21T08:00:00.000Z" },
  draw: { wetMassKg: 50, moisturePercent: 10 },
};
const RECORD_PREVIEW = creditBatchKeys.recordPreview(PREVIEW_INPUT);
const STOCK_PREVIEW = outputStockKeys.preview(null);
const SAVED_RECORD = creditBatchKeys.record("delivery", "d1");

function seeded() {
  const client = new QueryClient();
  for (const key of [RECORD_PREVIEW, STOCK_PREVIEW, SAVED_RECORD]) client.setQueryData(key, { cached: true });
  return client;
}

describe("invalidateAfterFailedStockSave", () => {
  it("invalidates the stock previews and the credit batch previews, not saved record lines", () => {
    const client = seeded();
    invalidateAfterFailedStockSave(client);
    expect(client.getQueryState(STOCK_PREVIEW)?.isInvalidated).toBe(true);
    expect(client.getQueryState(RECORD_PREVIEW)?.isInvalidated).toBe(true);
    expect(client.getQueryState(SAVED_RECORD)?.isInvalidated).toBe(false);
  });

  it("runs when a stock post fails", async () => {
    post.mockResolvedValueOnce({ success: false, error: "Stock changed since this preview." });
    const client = seeded();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePostOutputStock(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({} as never).catch(() => undefined);
    });
    expect(client.getQueryState(RECORD_PREVIEW)?.isInvalidated).toBe(true);
  });
});

describe("a refused application save", () => {
  const REFUSAL = { success: false, error: "Application exceeds the saved delivery wet mass." };

  type SaveHook = () => { mutateAsync: (input: never) => Promise<unknown> };
  const cases: [string, typeof createApplication, SaveHook][] = [
    ["create", createApplication, useCreateApplication as SaveHook],
    ["update", updateApplication, useUpdateApplication as SaveHook],
  ];
  it.each(cases)("invalidates the credit batch previews on %s", async (_name, fn, useHook) => {
    fn.mockResolvedValueOnce(REFUSAL);
    const client = seeded();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(useHook, { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ applicationId: "a1", expectedVersion: 1 } as never).catch(() => undefined);
    });
    expect(fn).toHaveBeenCalled();
    expect(client.getQueryState(RECORD_PREVIEW)?.isInvalidated).toBe(true);
    expect(client.getQueryState(SAVED_RECORD)?.isInvalidated).toBe(false);
  });
});
