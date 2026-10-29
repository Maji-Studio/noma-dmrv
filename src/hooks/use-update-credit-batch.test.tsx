import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateCreditBatchData } from "@/schemas/credit-batches";
import { entityKeys } from "./entity-query-keys";
import { useUpdateCreditBatch } from "./use-credit-batches";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/fn/credit-batches", () => ({ updateCreditBatchFn: mocks.update }));
vi.mock("@/lib/read-api/client", () => ({ getOnboardingStatusRead: vi.fn() }));
vi.mock("./use-certification", () => ({ invalidateCertificationReadiness: vi.fn() }));

const row = { id: "batch-1", facilityId: "facility-1", code: "CB-001", name: "September maize" };
let client: QueryClient;
let renderer: ReactTestRenderer;
let mutation: ReturnType<typeof useUpdateCreditBatch>;
function Harness() {
  const current = useUpdateCreditBatch();
  useEffect(() => { mutation = current; }, [current]);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

describe("useUpdateCreditBatch", () => {
  it("refreshes the credit batch picker caches after a rename", async () => {
    mocks.update.mockResolvedValueOnce({ success: true, data: row });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => {
      await mutation.mutateAsync({ creditBatchId: row.id, expectedVersion: 1, name: row.name } as UpdateCreditBatchData);
    });
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(entityKeys.listPrefix("creditBatch"));
    expect(keys).toContainEqual(entityKeys.detailPrefix("creditBatch"));
  });
});
