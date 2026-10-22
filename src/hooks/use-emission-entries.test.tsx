// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getBatchEmissionLinesFn } from "@/fn/emission-entries";
import { EmissionLinesBlockedError, isEmissionLinesBlocked } from "@/lib/certification/emission-lines-blocked-error";
import { REMOVAL_TEMPLATE_BLOCKERS, removalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import { useBatchEmissionLines } from "./use-emission-entries";

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

it("exposes unpinnedTemplate as a typed error without retrying", async () => {
  const blocker = removalTemplateBlocker("unpinnedTemplate");
  vi.mocked(getBatchEmissionLinesFn).mockResolvedValue({ success: true, data: {
    status: "blocked", blocker: "unpinnedTemplate", storedEntries: [],
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
    status: "blocked", blocker: "templateNotFullyRead", storedEntries: [],
  } });
  const { result } = renderHook(() => useBatchEmissionLines(scope), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(getBatchEmissionLinesFn).toHaveBeenCalledTimes(DEFAULT_QUERY_RETRY_LIMIT + 1);
  expect(result.current.error?.message).toBe(REMOVAL_TEMPLATE_BLOCKERS.templateNotFullyRead);
  expect(isEmissionLinesBlocked(result.current.error)).toBe(false);
});

it("recovers when a retry finds the observation", async () => {
  vi.mocked(getBatchEmissionLinesFn)
    .mockResolvedValueOnce({ success: true, data: { status: "blocked", blocker: "templateNotFullyRead", storedEntries: [] } })
    .mockResolvedValue({ success: true, data: { status: "ready", lines: [], storedEntries: [] } });
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
  vi.mocked(getBatchEmissionLinesFn).mockResolvedValue({ success: true, data: { status: "ready", lines: [], storedEntries: [] } });
  const { result } = renderHook(() => useBatchEmissionLines(scope), { wrapper });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual([]);
  expect(getBatchEmissionLinesFn).toHaveBeenCalledExactlyOnceWith(scope);
});
