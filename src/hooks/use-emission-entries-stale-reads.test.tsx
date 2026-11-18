// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmissionEntryFn } from "@/fn/emission-entries";
import { certificationKeys } from "./certification-query-keys";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { useCreateEmissionEntry } from "./use-emission-entries";

vi.mock("@/fn/emission-entries", () => ({
  getBatchEmissionLinesFn: vi.fn(),
  createEmissionEntryFn: vi.fn(),
  updateEmissionEntryFn: vi.fn(),
  confirmEmissionEntryFn: vi.fn(),
  deleteEmissionEntryFn: vi.fn(),
  restoreEmissionEntryFn: vi.fn(),
  replaceEmissionEntryFn: vi.fn(),
}));

const scope = { facilityId: "facility", creditBatchId: "batch" };
const input = {
  creditBatchId: scope.creditBatchId,
  componentId: "energy",
  values: [{ inputKey: "energy", quantityKind: "energy" as const, magnitude: "1", unit: "kWh" }],
};
const linesKey = creditBatchKeys.emissionLines(scope.facilityId, scope.creditBatchId);
const overviewKey = certificationKeys.overview(scope.facilityId);
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient();
  client.setQueryData(linesKey, []);
  client.setQueryData(overviewKey, {});
});
afterEach(() => {
  cleanup();
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function save() {
  const { result } = renderHook(() => useCreateEmissionEntry(scope), { wrapper });
  await act(async () => { await result.current.mutateAsync(input).catch(() => undefined); });
}

it("makes the lines and readiness stale after a failed save", async () => {
  vi.mocked(createEmissionEntryFn).mockResolvedValue({ success: false, error: "Stale version" });
  await save();
  expect(client.getQueryState(linesKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(overviewKey)?.isInvalidated).toBe(true);
});

it("makes the lines and readiness stale after a successful save", async () => {
  vi.mocked(createEmissionEntryFn).mockResolvedValue({ success: true, data: {} as never });
  await save();
  expect(client.getQueryState(linesKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(overviewKey)?.isInvalidated).toBe(true);
});
