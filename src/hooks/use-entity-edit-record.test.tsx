// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanManageFeedstockTypes, useEntityEditRecord, type EditableEntityType } from "./use-entity-edit-record";
import { supplierKeys } from "./supplier-query-keys";

const mocks = vi.hoisted(() => ({ read: vi.fn(), permission: vi.fn() }));
vi.mock("@/fn/formulations", () => ({ getFormulationByIdFn: mocks.read }));
vi.mock("@/fn/suppliers", () => ({ getSupplierByIdFn: mocks.read }));
vi.mock("@/fn/customers", () => ({ getCustomerWithRelationsFn: mocks.read }));
vi.mock("@/fn/feedstock-types", () => ({ getFeedstockTypeByIdFn: mocks.read, canManageFeedstockTypesFn: mocks.permission }));
vi.mock("@/fn/reactors", () => ({ getReactorByIdFn: mocks.read }));
vi.mock("@/fn/orders", () => ({ getOrderByIdFn: mocks.read }));
vi.mock("@/fn/storage-locations", () => ({ getStorageLocationFn: mocks.read }));
vi.mock("@/fn/fleet", () => ({ getVehicleFn: mocks.read, getDriverFn: mocks.read, getOperatorFn: mocks.read, listVehiclesFn: vi.fn(), listDriversFn: vi.fn(), listOperatorsFn: vi.fn() }));
const record = { id: "one", version: 2, name: "Fresh" };
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks(); mocks.read.mockResolvedValue({ success: true, data: record });
});
afterEach(() => { cleanup(); client.clear(); });
it.each<EditableEntityType>(["formulation", "supplier", "customer", "feedstockType", "reactor", "order", "storageLocation", "vehicle", "driver", "operator"])("loads %s through the existing action and key factory", async (type) => {
  const { result } = renderHook(() => useEntityEditRecord(type, "one"), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual(record);
  const payload = type === "storageLocation" ? { storageLocationId: "one" } : ["vehicle", "driver", "operator"].includes(type) ? { [`${type}Id`]: "one" } : "one";
  expect(mocks.read).toHaveBeenCalledWith(payload);
});
it("refetches a cached record on each new edit session", async () => {
  client.setQueryData(supplierKeys.detail("one"), { ...record, version: 1 });
  const first = renderHook(() => useEntityEditRecord("supplier", "one"), { wrapper });
  await waitFor(() => expect(first.result.current.isFetchedAfterMount).toBe(true));
  expect(first.result.current.data?.version).toBe(2); first.unmount();
  mocks.read.mockResolvedValue({ success: true, data: { ...record, version: 3 } });
  const second = renderHook(() => useEntityEditRecord("supplier", "one"), { wrapper });
  await waitFor(() => expect(second.result.current.data?.version).toBe(3));
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it.each([true, false])("uses the server's management permission: %s", async (allowed) => {
  mocks.permission.mockResolvedValue({ success: true, data: allowed });
  const { result } = renderHook(useCanManageFeedstockTypes, { wrapper });
  expect(result.current).toBe(false);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await waitFor(() => expect(result.current).toBe(allowed));
});
