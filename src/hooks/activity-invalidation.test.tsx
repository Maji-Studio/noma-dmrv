// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { activityKeys } from "./activity-query-keys";

const ok = vi.hoisted(() => () => Promise.resolve({ success: true, data: undefined }));
vi.mock("@/fn/transport-legs", () => ({ deleteTransportLegFn: vi.fn(ok) }));
vi.mock("@/fn/feedstocks", () => ({ deleteFeedstockFn: vi.fn(ok) }));
const savedDelivery = vi.hoisted(() => () => Promise.resolve({ success: true, data: { id: "33333333-3333-4333-8333-333333333333", savedProducts: [] } }));
vi.mock("@/fn/deliveries", () => ({ deleteDeliveryFn: vi.fn(ok), createDeliveryFn: vi.fn(savedDelivery), updateDeliveryFn: vi.fn(savedDelivery) }));
vi.mock("@/fn/orders", () => ({ deleteOrderFn: vi.fn(ok) }));
vi.mock("@/fn/biochar-products", () => ({ deleteBiocharProductFn: vi.fn(ok) }));
vi.mock("@/fn/documents", () => ({ requestUpload: vi.fn(ok), setDocumentVisibility: vi.fn(ok) }));

import { useDeleteTransportLeg } from "./use-transport-legs";
import { useDeleteFeedstock } from "./use-feedstocks";
import { useCreateDelivery, useDeleteDelivery, useUpdateDelivery } from "./use-deliveries";
import { orderKeys } from "./use-orders";
import { useDeleteOrder } from "./use-orders";
import { useDeleteBiocharProduct } from "./use-biochar-products";
import { useRequestUpload, useSetDocumentVisibility } from "./use-documents";

afterEach(cleanup);

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";

// Each family writes activity on the batches it reaches, so an open batch
// sheet or Activity segment must refetch after the write.
it.each([
  ["transport leg", () => useDeleteTransportLeg("feedstock", RECORD_ID), { id: RECORD_ID, expectedVersion: 1 }],
  ["feedstock", () => useDeleteFeedstock(), { feedstockId: RECORD_ID, expectedVersion: 1 }],
  ["delivery", () => useDeleteDelivery(), { deliveryId: RECORD_ID, expectedVersion: 1 }],
  ["order", () => useDeleteOrder(), { orderId: RECORD_ID, expectedVersion: 1 }],
  ["biochar product", () => useDeleteBiocharProduct(undefined, { optimistic: false }), { productId: RECORD_ID, expectedVersion: 1 }],
  ["document upload request", () => useRequestUpload(), { entityType: "feedstock", entityId: RECORD_ID }],
  ["document visibility", () => useSetDocumentVisibility(), { documentId: RECORD_ID, visibility: "internal", expectedVersion: 1 }],
] as const)("refreshes batch activity after a %s write", async (_family, useHook, variables) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(activityKeys.creditBatchSummary(BATCH_ID), { total: 0, counts: [], latest: null });
  client.setQueryData(activityKeys.creditBatch(BATCH_ID, 5), { pages: [], pageParams: [] });
  const { result, unmount } = renderHook(() => useHook(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await act(async () => {
    await (result.current.mutateAsync as (input: unknown) => Promise<unknown>)(variables);
  });
  expect(client.getQueryState(activityKeys.creditBatchSummary(BATCH_ID))?.isInvalidated).toBe(true);
  expect(client.getQueryState(activityKeys.creditBatch(BATCH_ID, 5))?.isInvalidated).toBe(true);
  unmount();
  client.clear();
});

// A delivery moves its order's derived fulfillment, so the `?order=` detail
// read and the order lists must refetch after every delivery write.
it.each([
  ["create", () => useCreateDelivery(), { orderId: RECORD_ID }],
  ["update", () => useUpdateDelivery(), { deliveryId: RECORD_ID, expectedVersion: 1 }],
  ["delete", () => useDeleteDelivery(), { deliveryId: RECORD_ID, expectedVersion: 1 }],
] as const)("refreshes the order detail and lists after a delivery %s", async (_kind, useHook, variables) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(orderKeys.detailWithRelations(RECORD_ID), { id: RECORD_ID });
  client.setQueryData(orderKeys.list({}), { items: [] });
  const { result, unmount } = renderHook(() => useHook(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await act(async () => {
    await (result.current.mutateAsync as (input: unknown) => Promise<unknown>)(variables);
  });
  expect(client.getQueryState(orderKeys.detailWithRelations(RECORD_ID))?.isInvalidated).toBe(true);
  expect(client.getQueryState(orderKeys.list({}))?.isInvalidated).toBe(true);
  unmount();
  client.clear();
});
