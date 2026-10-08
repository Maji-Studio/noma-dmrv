import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";

const mocks = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), post: vi.fn(), createDelivery: vi.fn() }));
vi.mock("@/fn/production-incidents", () => ({ getProductionIncidentsFn: vi.fn(), createProductionIncidentFn: vi.fn(), updateProductionIncidentFn: mocks.update, deleteProductionIncidentFn: mocks.remove }));
vi.mock("@/fn/production-samples", () => ({ getProductionSamplesFn: vi.fn(), createProductionSampleFn: vi.fn(), updateProductionSampleFn: mocks.update, deleteProductionSampleFn: mocks.remove }));
vi.mock("@/fn/production-runs", () => ({ getProductionRunByIdFn: vi.fn(), getProductionRunReadingsFn: vi.fn(), createProductionRunFn: vi.fn(), updateProductionRunFn: mocks.update, deleteProductionRunFn: mocks.remove }));
vi.mock("@/fn/biochar-products", () => ({ getBiocharProductsFn: vi.fn(), getBiocharProductByIdFn: vi.fn(), createBiocharProductFn: vi.fn(), updateBiocharProductFn: mocks.update, deleteBiocharProductFn: mocks.remove }));
vi.mock("@/fn/output-stock", () => ({ getMatchingOutputBinsFn: vi.fn(), getOutputStockHistoryFn: vi.fn(), getOutputSubBinsFn: vi.fn(), postOutputStockFn: mocks.post, previewOutputStockFn: vi.fn() }));
// Keep indirectly imported query-key factories without loading server modules.
vi.mock("@/fn/certification", () => ({}));
vi.mock("@/fn/orders", () => ({}));
vi.mock("@/fn/chain-of-custody", () => ({}));
vi.mock("@/fn/storage-locations", () => ({}));
vi.mock("@/fn/facilities", () => ({}));
vi.mock("@/fn/reactors", () => ({}));
vi.mock("@/fn/credit-batches", () => ({}));
import { useUpdateProductionIncident, useDeleteProductionIncident } from "./use-production-incidents";
import { useUpdateProductionSample, useDeleteProductionSample } from "./use-production-samples";
import { useUpdateProductionRun, useDeleteProductionRun } from "./use-production-runs";
import { useUpdateBiocharProduct, useDeleteBiocharProduct } from "./use-biochar-products";
vi.mock("@/fn/deliveries", () => ({ createDeliveryFn: mocks.createDelivery, deleteDeliveryFn: vi.fn(), getDeliveriesFn: vi.fn(), getDeliveryStatsFn: vi.fn(), getDeliveryWithRelationsFn: vi.fn(), updateDeliveryFn: vi.fn() }));
import { useCreateDelivery, deliveryKeys } from "./use-deliveries";
import { biocharProductKeys } from "./use-biochar-products";
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
  mocks.post.mockResolvedValueOnce({ success: true, data: { savedProducts: [saved], savedDeliveries: [] } });
  const client = new QueryClient();
  const key = ["biocharProducts", "list", "one"];
  client.setQueryData(key, { items: [{ id: ID, version: INITIAL_VERSION }] });
  await harness(usePostOutputStock, client, {}, async invoke => {
    await act(async () => { await invoke(); });
    expect(client.getQueryData(key)).toMatchObject({ items: [{ version: SAVED_VERSION }] });
  });
});


describe("delivery creation product caches", () => {
  it.each([false, true])("merges saved product rows and invalidates lists and details (replay: %s)", async replay => {
    const delivery = { id: "delivery", savedProducts: replay ? [] : [saved] };
    mocks.createDelivery.mockResolvedValueOnce({ success: true, data: delivery });
    const client = new QueryClient();
    const initial = { id: ID, version: INITIAL_VERSION, relation: "preserved" };
    const other = { id: "unaffected", version: INITIAL_VERSION };
    const keys = [biocharProductKeys.list({ page: 1 }), biocharProductKeys.list({ page: 2 })];
    for (const key of keys) client.setQueryData(key, { items: [initial, other], total: 2 });
    client.setQueryData(biocharProductKeys.detail(ID), initial);
    client.setQueryData(biocharProductKeys.detail(other.id), other);
    const unrelatedKey = ["unrelated", "list"];
    client.setQueryData(unrelatedKey, initial);
    const expected = replay ? initial : { ...initial, ...saved };
    const invalidate = client.invalidateQueries.bind(client);
    vi.spyOn(client, "invalidateQueries").mockImplementation((...args) => {
      expect(client.getQueryData(biocharProductKeys.detail(ID))).toEqual(expected);
      for (const key of keys) expect(client.getQueryData(key)).toEqual({ items: [expected, other], total: 2 });
      return invalidate(...args);
    });
    await harness(useCreateDelivery, client, {}, async invoke => {
      await act(async () => { await invoke(); });
      for (const key of keys) {
        expect(client.getQueryData(key)).toEqual({ items: [expected, other], total: 2 });
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      }
      expect(client.getQueryData(biocharProductKeys.detail(ID))).toEqual(expected);
      expect(client.getQueryState(biocharProductKeys.detail(ID))?.isInvalidated).toBe(true);
      expect(client.getQueryData(biocharProductKeys.detail(other.id))).toEqual(other);
      expect(client.getQueryState(biocharProductKeys.detail(other.id))?.isInvalidated).toBe(true);
      expect(client.getQueryData(deliveryKeys.detail(delivery.id))).toEqual(delivery);
      expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
    });
  });
});
