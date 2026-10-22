// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmissionEntryFn, getBatchEmissionLinesFn } from "@/fn/emission-entries";
import { EmissionLinesBlockedError, isEmissionLinesBlocked } from "@/lib/certification/emission-lines-blocked-error";
import { REMOVAL_TEMPLATE_BLOCKERS, removalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import { useBatchEmissionLines, useCreateEmissionEntry } from "./use-emission-entries";

vi.mock("@/fn/emission-entries", () => ({
  getBatchEmissionLinesFn: vi.fn(),
  createEmissionEntryFn: vi.fn(),
  updateEmissionEntryFn: vi.fn(),
  confirmEmissionEntryFn: vi.fn(),
  deleteEmissionEntryFn: vi.fn(),
  restoreEmissionEntryFn: vi.fn(),
  replaceEmissionEntryFn: vi.fn(),
}));
vi.mock("./use-certification", () => ({ invalidateCertificationReadiness: vi.fn() }));
vi.mock("./use-energy", () => ({ energyKeys: { all: ["energy"] } }));

const DEFAULT_QUERY_RETRY_LIMIT = 3;
const scope = { facilityId: "facility", creditBatchId: "batch" };
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it("uses a different create intent key for each mounted manual entry draft", async () => {
  vi.mocked(createEmissionEntryFn).mockResolvedValue({ success: false, error: "Try again" });
  const input = {
    creditBatchId: scope.creditBatchId,
    componentId: "energy",
    values: [{ inputKey: "energy", quantityKind: "energy" as const, magnitude: "1", unit: "kWh" }],
  };
  const first = renderHook(() => useCreateEmissionEntry(scope), { wrapper });
  await act(async () => { await expect(first.result.current.mutateAsync(input)).rejects.toThrow("Try again"); });
  first.rerender();
  await act(async () => { await expect(first.result.current.mutateAsync(input)).rejects.toThrow("Try again"); });
  first.unmount();
  const second = renderHook(() => useCreateEmissionEntry(scope), { wrapper });
  await act(async () => { await expect(second.result.current.mutateAsync(input)).rejects.toThrow("Try again"); });
  const keys = vi.mocked(createEmissionEntryFn).mock.calls.map(([, options]) => options?.intentKey);
  expect(keys[0]).toEqual(expect.any(String));
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).toEqual(expect.any(String));
  expect(keys[2]).not.toBe(keys[0]);
});

it("exposes unpinnedTemplate as a typed error without retrying", async () => {
  const blocker = removalTemplateBlocker("unpinnedTemplate");
  vi.mocked(getBatchEmissionLinesFn).mockResolvedValue({ success: true, data: {
    status: "blocked", blocker: "unpinnedTemplate",
  } });
  const { result } = renderHook(() => useBatchEmissionLines(scope), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(getBatchEmissionLinesFn).toHaveBeenCalledExactlyOnceWith(scope);
  expect(result.current.error).toBeInstanceOf(EmissionLinesBlockedError);
  expect(result.current.error).toMatchObject({ blocker, message: blocker.message });
  expect(isEmissionLinesBlocked(result.current.error)).toBe(true);
  expect(result.current.data).toBeUndefined();
});

it("retries templateNotFullyRead with the existing message", async () => {
  vi.mocked(getBatchEmissionLinesFn).mockResolvedValue({ success: true, data: {
    status: "blocked", blocker: "templateNotFullyRead",
  } });
  const { result } = renderHook(() => useBatchEmissionLines(scope), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(getBatchEmissionLinesFn).toHaveBeenCalledTimes(DEFAULT_QUERY_RETRY_LIMIT + 1);
  expect(result.current.error?.message).toBe(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
  expect(isEmissionLinesBlocked(result.current.error)).toBe(false);
});

it("recovers when a retry finds the observation", async () => {
  vi.mocked(getBatchEmissionLinesFn)
    .mockResolvedValueOnce({ success: true, data: { status: "blocked", blocker: "templateNotFullyRead" } })
    .mockResolvedValue({ success: true, data: { status: "ready", lines: [] } });
  const { result } = renderHook(() => useBatchEmissionLines(scope), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual([]);
  expect(getBatchEmissionLinesFn).toHaveBeenCalledTimes(2);
});

it("retries real failures up to the default query retry limit", async () => {
  const error = new Error("Read failed.");
  vi.mocked(getBatchEmissionLinesFn).mockRejectedValue(error);
  const { result } = renderHook(() => useBatchEmissionLines(scope), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(getBatchEmissionLinesFn).toHaveBeenCalledTimes(DEFAULT_QUERY_RETRY_LIMIT + 1);
  expect(result.current.error).toBe(error);
  expect(isEmissionLinesBlocked(result.current.error)).toBe(false);
});

it("returns ready lines as array data", async () => {
  vi.mocked(getBatchEmissionLinesFn).mockResolvedValue({ success: true, data: { status: "ready", lines: [] } });
  const { result } = renderHook(() => useBatchEmissionLines(scope), { wrapper });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual([]);
  expect(getBatchEmissionLinesFn).toHaveBeenCalledExactlyOnceWith(scope);
});
