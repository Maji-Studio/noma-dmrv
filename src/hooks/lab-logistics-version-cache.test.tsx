import { biocharProductKeys } from "./use-biochar-products";
import { outputStockKeys } from "./use-output-stock";
import { storageLocationKeys } from "./use-storage-locations";
import { certificationKeys } from "./use-certification";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), post: vi.fn() }));
vi.mock("@/fn/samples", () => ({ getSamplesFn: vi.fn(), getSampleByIdFn: vi.fn(), getSampleStatsFn: vi.fn(), createSampleFn: vi.fn(), updateSampleFn: mocks.update, deleteSampleFn: mocks.remove }));
vi.mock("@/fn/orders", () => ({ getOrdersFn: vi.fn(), getOrdersForSelectFn: vi.fn(), createOrderFn: vi.fn(), updateOrderFn: mocks.update, deleteOrderFn: mocks.remove }));
vi.mock("@/fn/deliveries", () => ({ getDeliveriesFn: vi.fn(), getDeliveryWithRelationsFn: vi.fn(), getDeliveryStatsFn: vi.fn(), createDeliveryFn: vi.fn(), updateDeliveryFn: mocks.update, deleteDeliveryFn: mocks.remove }));
vi.mock("@/fn/applications", () => ({ getApplicationsFn: vi.fn(), getApplicationDeliveryOptionsFn: vi.fn(), createApplicationFn: mocks.create, updateApplicationFn: mocks.update, deleteApplicationFn: mocks.remove }));
vi.mock("@/fn/credit-batches", () => ({ getCreditBatchByIdFn: vi.fn(), getCo2eStoredPreviewsFn: vi.fn(), getCreditBatchProductionRunOptionsFn: vi.fn(), createCreditBatchFn: vi.fn(), updateCreditBatchFn: mocks.update, deleteCreditBatchFn: mocks.remove }));
vi.mock("@/fn/transport-legs", () => ({ getTransportLegsForEntityFn: vi.fn(), createTransportLegFn: vi.fn(), updateTransportLegFn: mocks.update, deleteTransportLegFn: mocks.remove }));
vi.mock("@/fn/output-stock", () => ({ postOutputStockFn: mocks.post }));
import { useUpdateSample, useDeleteSample } from "./use-samples";
import { useUpdateOrder, useDeleteOrder } from "./use-orders";
import { useUpdateDelivery, useDeleteDelivery } from "./use-deliveries";
import { useCreateApplication, useUpdateApplication, useDeleteApplication } from "./use-applications";
import { useUpdateCreditBatch, useDeleteCreditBatch } from "./use-credit-batches";
import { useUpdateTransportLeg, useDeleteTransportLeg } from "./use-transport-legs";
import { usePostOutputStock } from "./use-output-stock";
const ID = "33333333-3333-4333-8333-333333333333";
const INITIAL_VERSION = 1;
const SAVED_VERSION = INITIAL_VERSION + 1;
const saved = { id: ID, version: SAVED_VERSION, facilityId: "facility", code: "PR-1" };
const cases = [
  { entity: "samples", idKey: "sampleId", array: false, useUpdate: useUpdateSample, useDelete: useDeleteSample },
  { entity: "orders", idKey: "orderId", array: false, useUpdate: useUpdateOrder, useDelete: useDeleteOrder },
  { entity: "deliveries", idKey: "deliveryId", array: false, useUpdate: useUpdateDelivery, useDelete: useDeleteDelivery },
  { entity: "applications", idKey: "applicationId", array: false, useUpdate: useUpdateApplication, useDelete: useDeleteApplication },
  { entity: "creditBatches", idKey: "creditBatchId", array: true, useUpdate: useUpdateCreditBatch, useDelete: useDeleteCreditBatch },
  { entity: "transportLegs", idKey: "id", array: true, useUpdate: () => useUpdateTransportLeg("sample", ID), useDelete: () => useDeleteTransportLeg("sample", ID) },
];
const listKeys = (entity: string) => entity === "transportLegs" ? [[entity, "sample", ID]] : [[entity, "list", "one"], [entity, "list", "two"]];

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
    // A delivery update also returns the products its stock correction touched.
    mocks.update.mockResolvedValueOnce({ success: true, data: testCase.entity === "deliveries" ? { ...saved, savedProducts: [] } : saved });
    const client = new QueryClient();
    const keys = listKeys(testCase.entity);
    const detailKey = [testCase.entity, "detail", ID];
    if (testCase.entity !== "transportLegs") client.setQueryData(detailKey, { id: ID, version: INITIAL_VERSION });
    for (const key of keys) {
      const rows = [{ id: ID, version: INITIAL_VERSION, relation: "preserved" }];
      client.setQueryData(key, testCase.array ? rows : { items: rows, total: 1 });
    }
    await harness(testCase.useUpdate, client, { [testCase.idKey]: ID, expectedVersion: INITIAL_VERSION, productionRunId: ID }, async invoke => {
      await act(async () => { await invoke(); });
      if (testCase.entity !== "transportLegs") expect(client.getQueryData(detailKey)).toMatchObject({ version: SAVED_VERSION });
      for (const key of keys) {
        const data = client.getQueryData(key) as { items: object[] } | object[];
        expect(Array.isArray(data) ? data[0] : data.items[0]).toMatchObject({ ...saved, relation: "preserved" });
      }
    });
  });
  it("throws a stale update without replacing the loaded version", async () => {
    mocks.update.mockResolvedValueOnce({ success: false, error: STALE_VERSION_MESSAGE, code: "stale_version", conflict: { entity: testCase.entity, id: ID, code: STALE_VERSION_CONFLICT_CODE } });
    const client = new QueryClient();
    const key = listKeys(testCase.entity)[0];
    const rows = [{ id: ID, version: INITIAL_VERSION }];
    client.setQueryData(key, testCase.array ? rows : { items: rows });
    await harness(testCase.useUpdate, client, { [testCase.idKey]: ID, expectedVersion: INITIAL_VERSION }, async invoke => {
      await act(async () => { await expect(invoke()).rejects.toBeInstanceOf(StaleVersionError); });
      expect(client.getQueryData(key)).toEqual(testCase.array ? rows : { items: rows });
    });
  });
  it("keeps stale failures typed and refreshes the refused delete list", async () => {
    mocks.remove.mockResolvedValueOnce({ success: false, error: STALE_VERSION_MESSAGE, code: "stale_version", conflict: { entity: testCase.entity, id: ID, code: STALE_VERSION_CONFLICT_CODE } });
    const client = new QueryClient();
    const key = listKeys(testCase.entity)[0];
    client.setQueryData(key, testCase.array ? [saved] : { items: [saved] });
    await harness(testCase.useDelete, client, { [testCase.idKey]: ID, expectedVersion: INITIAL_VERSION }, async invoke => {
      await act(async () => { await expect(invoke()).rejects.toBeInstanceOf(StaleVersionError); });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });
});

it("merges corrected delivery versions into cached edit rows", async () => {
  mocks.post.mockResolvedValueOnce({ success: true, data: { savedProducts: [], savedDeliveries: [saved] } });
  const client = new QueryClient();
  const key = ["deliveries", "list", "one"];
  client.setQueryData(key, { items: [{ id: ID, version: INITIAL_VERSION }] });
  await harness(usePostOutputStock, client, {}, async invoke => {
    await act(async () => { await invoke(); });
    expect(client.getQueryData(key)).toMatchObject({ items: [{ version: SAVED_VERSION }] });
  });
});

it("merges the product versions a delivery mass edit returns and keeps them off the delivery", async () => {
  const product = { id: "44444444-4444-4444-8444-444444444444", version: SAVED_VERSION, code: "BP-1" };
  mocks.update.mockResolvedValueOnce({ success: true, data: { ...saved, savedProducts: [product] } });
  const client = new QueryClient();
  const productKey = ["biocharProducts", "list", "one"];
  client.setQueryData(productKey, { items: [{ id: product.id, version: INITIAL_VERSION }] });
  client.setQueryData(["deliveries", "detail", ID], { id: ID, version: INITIAL_VERSION });
  await harness(useUpdateDelivery, client, { deliveryId: ID, expectedVersion: INITIAL_VERSION }, async invoke => {
    await act(async () => { await invoke(); });
    expect(client.getQueryData(productKey)).toMatchObject({ items: [{ version: SAVED_VERSION }] });
    expect(client.getQueryData(["deliveries", "detail", ID])).not.toHaveProperty("savedProducts");
  });
});

it("sends cleared application defaults explicitly on create so the operation cannot refill them", async () => {
  mocks.create.mockResolvedValueOnce({ success: true, data: saved });
  await harness(useCreateApplication, new QueryClient(), { deliveryId: ID, biocharAppliedKg: 1000 }, async invoke => {
    await act(async () => { await invoke(); });
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ appliedWetMassKg: 1000, gpsLatitude: null, gpsLongitude: null, soilTemperatureC: null, soilTemperatureSource: null }));
  });
});

it("sends cleared application defaults explicitly so the operation cannot refill them", async () => {
  mocks.update.mockResolvedValueOnce({ success: true, data: saved });
  await harness(useUpdateApplication, new QueryClient(), { applicationId: ID, expectedVersion: 1, biocharAppliedKg: 1000 }, async invoke => {
    await act(async () => { await invoke(); });
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ appliedWetMassKg: 1000, gpsLatitude: null, gpsLongitude: null, soilTemperatureC: null, soilTemperatureSource: null }));
  });
});


it("invalidates product versions, stock and record locks after deleting a delivery", async () => {
  mocks.remove.mockResolvedValueOnce({ success: true });
  const client = new QueryClient();
  const keys = [
    biocharProductKeys.list({}), biocharProductKeys.detail(ID),
    outputStockKeys.all, storageLocationKeys.all,
    certificationKeys.recordLock("biocharProduct", ID),
  ];
  for (const key of keys) client.setQueryData(key, { version: INITIAL_VERSION });
  await harness(useDeleteDelivery, client, { deliveryId: ID, expectedVersion: INITIAL_VERSION }, async invoke => {
    await act(async () => { await invoke(); });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
