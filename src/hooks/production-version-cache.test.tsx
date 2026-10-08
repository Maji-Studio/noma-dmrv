import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";

const mocks = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), post: vi.fn() }));
vi.mock("@/fn/production-incidents", () => ({ getProductionIncidentsFn: vi.fn(), createProductionIncidentFn: vi.fn(), updateProductionIncidentFn: mocks.update, deleteProductionIncidentFn: mocks.remove }));
vi.mock("@/fn/production-samples", () => ({ getProductionSamplesFn: vi.fn(), createProductionSampleFn: vi.fn(), updateProductionSampleFn: mocks.update, deleteProductionSampleFn: mocks.remove }));
vi.mock("@/fn/production-runs", () => ({ getProductionRunByIdFn: vi.fn(), getProductionRunReadingsFn: vi.fn(), createProductionRunFn: vi.fn(), updateProductionRunFn: mocks.update, deleteProductionRunFn: mocks.remove }));
vi.mock("@/fn/biochar-products", () => ({ getBiocharProductsFn: vi.fn(), getBiocharProductByIdFn: vi.fn(), createBiocharProductFn: vi.fn(), updateBiocharProductFn: mocks.update, deleteBiocharProductFn: mocks.remove }));
vi.mock("@/fn/output-stock", () => ({ getMatchingOutputBinsFn: vi.fn(), getOutputStockHistoryFn: vi.fn(), getOutputSubBinsFn: vi.fn(), postOutputStockFn: mocks.post, previewOutputStockFn: vi.fn() }));
import { useUpdateProductionIncident, useDeleteProductionIncident } from "./use-production-incidents";
import { useUpdateProductionSample, useDeleteProductionSample } from "./use-production-samples";
import { useUpdateProductionRun, useDeleteProductionRun } from "./use-production-runs";
import { useUpdateBiocharProduct, useDeleteBiocharProduct } from "./use-biochar-products";
import { usePostOutputStock } from "./use-output-stock";

const ID = "33333333-3333-4333-8333-333333333333";
const INITIAL_VERSION = 1;
const SAVED_VERSION = INITIAL_VERSION + 1;
const saved = { id: ID, version: SAVED_VERSION, facilityId: "facility", code: "PR-1" };
const cases = [
  { entity: "productionIncidents", idKey: "productionIncidentId", array: true, useUpdate: useUpdateProductionIncident, useDelete: () => useDeleteProductionIncident("run") },
  { entity: "productionSamples", idKey: "productionSampleId", array: true, useUpdate: useUpdateProductionSample, useDelete: () => useDeleteProductionSample("run") },
  { entity: "productionRuns", idKey: "productionRunId", array: false, useUpdate: () => useUpdateProductionRun(undefined, { optimistic: false }), useDelete: () => useDeleteProductionRun(undefined, { optimistic: false }) },
  { entity: "biocharProducts", idKey: "productId", array: false, useUpdate: () => useUpdateBiocharProduct(undefined, { optimistic: false }), useDelete: () => useDeleteBiocharProduct(undefined, { optimistic: false }) },
];

async function harness(useMutation: () => { mutateAsync: (input: never) => Promise<unknown> }, client: QueryClient, input: object, check: (invoke: () => Promise<unknown>) => Promise<void>) {
  function Harness() {
    const mutation = useMutation();
    return <button onClick={() => mutation.mutateAsync(input as never)}>Save</button>;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  try { await check(() => renderer.root.findByType("button").props.onClick()); }
  finally { await act(async () => renderer.unmount()); client.clear(); }
}

describe.each(cases)("$entity version caches", testCase => {
  it("merges the saved version into every list before refetch", async () => {
    mocks.update.mockResolvedValueOnce({ success: true, data: saved });
    const client = new QueryClient();
    const keys = [[testCase.entity, "list", "one"], [testCase.entity, "list", "two"]];
    for (const key of keys) {
      const rows = [{ id: ID, version: INITIAL_VERSION, relation: "preserved" }];
      client.setQueryData(key, testCase.array ? rows : { items: rows, total: 1 });
    }
    await harness(testCase.useUpdate, client, { [testCase.idKey]: ID, expectedVersion: INITIAL_VERSION, productionRunId: ID }, async invoke => {
      await act(async () => { await invoke(); });
      for (const key of keys) {
        const data = client.getQueryData(key) as { items: object[] } | object[];
        expect(Array.isArray(data) ? data[0] : data.items[0]).toMatchObject({ ...saved, relation: "preserved" });
      }
    });
  });
  it("keeps stale failures typed and refreshes the refused delete list", async () => {
    mocks.remove.mockResolvedValueOnce({ success: false, error: STALE_VERSION_MESSAGE, code: "stale_version", conflict: { entity: testCase.entity, id: ID, code: STALE_VERSION_CONFLICT_CODE } });
    const client = new QueryClient();
    const key = [testCase.entity, "list", "one"];
    client.setQueryData(key, testCase.array ? [saved] : { items: [saved] });
    await harness(testCase.useDelete, client, { [testCase.idKey]: ID, expectedVersion: INITIAL_VERSION }, async invoke => {
      await act(async () => { await expect(invoke()).rejects.toBeInstanceOf(StaleVersionError); });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });
});

it("merges corrected stock product versions into cached edit rows", async () => {
  mocks.post.mockResolvedValueOnce({ success: true, data: { savedProducts: [saved] } });
  const client = new QueryClient();
  const key = ["biocharProducts", "list", "one"];
  client.setQueryData(key, { items: [{ id: ID, version: INITIAL_VERSION }] });
  await harness(usePostOutputStock, client, {}, async invoke => {
    await act(async () => { await invoke(); });
    expect(client.getQueryData(key)).toMatchObject({ items: [{ version: SAVED_VERSION }] });
  });
});
