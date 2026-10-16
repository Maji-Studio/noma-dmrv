// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ archiveSupplier: vi.fn(), restoreSupplier: vi.fn(), archiveCustomer: vi.fn(), restoreCustomer: vi.fn() }));
vi.mock("@/fn/suppliers", () => ({
  getSuppliersFn: vi.fn(), getSupplierByIdFn: vi.fn(), createSupplierWithLocationsFn: vi.fn(), updateSupplierFn: vi.fn(),
  deleteSupplierFn: vi.fn(), getSupplierLocationsBySupplierFn: vi.fn(), createSupplierLocationFn: vi.fn(),
  updateSupplierLocationFn: vi.fn(), deleteSupplierLocationFn: vi.fn(),
  archiveSupplierFn: actions.archiveSupplier, restoreSupplierFn: actions.restoreSupplier,
}));
vi.mock("@/fn/customers", () => ({
  getCustomersFn: vi.fn(), getCustomerWithRelationsFn: vi.fn(), getCustomerLocationsFn: vi.fn(), createCustomerWithLocationsFn: vi.fn(),
  updateCustomerFn: vi.fn(), deleteCustomerFn: vi.fn(), createCustomerLocationFn: vi.fn(), updateCustomerLocationFn: vi.fn(),
  deleteCustomerLocationFn: vi.fn(),
  archiveCustomerFn: actions.archiveCustomer, restoreCustomerFn: actions.restoreCustomer,
}));
import { supplierKeys, useArchiveSupplier, useRestoreSupplier } from "./use-suppliers";
import { customerKeys, useArchiveCustomer, useRestoreCustomer } from "./use-customers";
import { entityKeys } from "./entity-query-keys";
import { STALE_VERSION_CONFLICT_CODE, StaleVersionError } from "@/lib/stale-version";

afterEach(cleanup);

const ARCHIVED_AT = new Date("2026-10-16T00:00:00Z");
function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe.each([
  { name: "archive", useLifecycle: useArchiveSupplier, action: actions.archiveSupplier, archivedAt: ARCHIVED_AT },
  { name: "restore", useLifecycle: useRestoreSupplier, action: actions.restoreSupplier, archivedAt: null },
])("supplier $name", ({ useLifecycle, action, archivedAt }) => {
  it("merges the returned row into every cached list and the detail cache before refetch", async () => {
    const client = new QueryClient();
    const row = { id: "supplier", version: 1, archivedAt: archivedAt ? null : ARCHIVED_AT, locationCount: 2 };
    const saved = { id: "supplier", version: 2, archivedAt };
    const keys = [supplierKeys.list(), supplierKeys.list({ archived: true })];
    for (const key of keys) client.setQueryData(key, { items: [row], total: 1 });
    client.setQueryData(supplierKeys.detail(row.id), row);
    client.setQueryData(entityKeys.list("supplier", "", undefined), []);
    action.mockResolvedValueOnce({ success: true, data: saved });
    const { result, unmount } = renderHook(() => useLifecycle(), { wrapper: wrapperFor(client) });
    await act(async () => { await result.current.mutateAsync({ supplierId: row.id, expectedVersion: 1 }); });
    expect(action).toHaveBeenCalledWith({ supplierId: row.id, expectedVersion: 1 });
    for (const key of keys) {
      expect(client.getQueryData(key)).toEqual({ items: [{ ...row, ...saved }], total: 1 });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryData(supplierKeys.detail(row.id))).toEqual({ ...row, ...saved });
    expect(client.getQueryState(entityKeys.list("supplier", "", undefined))?.isInvalidated).toBe(true);
    unmount();
    client.clear();
  });
});

describe.each([
  { name: "archive", useLifecycle: useArchiveCustomer, action: actions.archiveCustomer, archivedAt: ARCHIVED_AT },
  { name: "restore", useLifecycle: useRestoreCustomer, action: actions.restoreCustomer, archivedAt: null },
])("customer $name", ({ useLifecycle, action, archivedAt }) => {
  it("merges the returned row into the lists and the detail with relations before refetch", async () => {
    const client = new QueryClient();
    const row = { id: "customer", version: 1, archivedAt: archivedAt ? null : ARCHIVED_AT, locationCount: 1 };
    const saved = { id: "customer", version: 2, archivedAt };
    const listKey = customerKeys.list();
    client.setQueryData(listKey, { items: [row], total: 1 });
    client.setQueryData(customerKeys.detailWithRelations(row.id), { ...row, locations: [{ id: "location" }] });
    action.mockResolvedValueOnce({ success: true, data: saved });
    const { result, unmount } = renderHook(() => useLifecycle(), { wrapper: wrapperFor(client) });
    await act(async () => { await result.current.mutateAsync({ customerId: row.id, expectedVersion: 1 }); });
    expect(client.getQueryData(listKey)).toEqual({ items: [{ ...row, ...saved }], total: 1 });
    // The order form reads the parent's archive state from the relations detail.
    expect(client.getQueryData(customerKeys.detailWithRelations(row.id))).toEqual({ ...row, ...saved, locations: [{ id: "location" }] });
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    unmount();
    client.clear();
  });

  it("keeps a refused archive typed and refreshes the customer caches on a stale version", async () => {
    const client = new QueryClient();
    const refetch = vi.spyOn(client, "invalidateQueries");
    action.mockResolvedValueOnce({ success: false, error: "stale", conflict: { entity: "customer", id: "customer", code: STALE_VERSION_CONFLICT_CODE } });
    const { result, unmount } = renderHook(() => useLifecycle(), { wrapper: wrapperFor(client) });
    await act(async () => { await expect(result.current.mutateAsync({ customerId: "customer", expectedVersion: 1 })).rejects.toBeInstanceOf(StaleVersionError); });
    expect(refetch).toHaveBeenCalledWith({ queryKey: customerKeys.all });
    unmount();
    client.clear();
  });
});
