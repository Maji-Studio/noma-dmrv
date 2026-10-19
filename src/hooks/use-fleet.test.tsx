import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Operator, Vehicle } from "@/db/schema";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { entityKeys } from "./entity-query-keys";

const mocks = vi.hoisted(() => ({
  updateVehicleFn: vi.fn(),
  deleteOperatorFn: vi.fn(),
}));

vi.mock("@/fn/fleet", () => ({
  listVehiclesFn: vi.fn(),
  listDriversFn: vi.fn(),
  listOperatorsFn: vi.fn(),
  getVehicleFn: vi.fn(),
  getDriverFn: vi.fn(),
  getOperatorFn: vi.fn(),
  updateVehicleFn: mocks.updateVehicleFn,
  updateDriverFn: vi.fn(),
  updateOperatorFn: vi.fn(),
  deleteVehicleFn: vi.fn(),
  deleteDriverFn: vi.fn(),
  deleteOperatorFn: mocks.deleteOperatorFn,
}));

import { fleetKeys, useDeleteOperator, useUpdateVehicle } from "./use-fleet";

const vehicle: Vehicle = {
  id: "veh-1",
  version: 3,
  organizationId: "org-1",
  code: "VEH-001",
  name: "Feedstock truck",
  identifier: null,
  vehicleType: "truck",
  fuelType: "Diesel",
  fuelConsumptionLPerKm: null,
  modelYear: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};
const otherVehicle: Vehicle = { ...vehicle, id: "veh-2", code: "VEH-002", name: "Second truck" };

const operator: Operator = {
  id: "op-1",
  version: 1,
  organizationId: "org-1",
  name: "Asha",
  credentials: null,
  contactPhone: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

let tree: ReactTestRenderer;
let queryClient: QueryClient;

function Probe<T>({ useHook, onRender }: { useHook: () => T; onRender: (value: T) => void }) {
  onRender(useHook());
  return null;
}

async function renderHook<T>(useHook: () => T): Promise<{ current: T }> {
  const result = {} as { current: T };
  const capture = (value: T) => { result.current = value; };
  await act(async () => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <Probe useHook={useHook} onRender={capture} />
      </QueryClientProvider>,
    );
  });
  return result;
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  // Invalidation would refetch with the mocked list actions; keep the caches as
  // the mutation left them so the test reads what Edit and Delete would get.
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

describe("fleet mutation caches", () => {
  it("merges the saved version into the settings list and the picker caches", async () => {
    const saved = { ...vehicle, name: "Renamed truck", version: 4 };
    mocks.updateVehicleFn.mockResolvedValue({ success: true, data: saved });
    queryClient.setQueryData(fleetKeys.list("vehicle"), [vehicle, otherVehicle]);
    const update = await renderHook(() => useUpdateVehicle());

    await act(async () => {
      await update.current.mutateAsync({ ...vehicle, vehicleId: vehicle.id, expectedVersion: 3, name: "Renamed truck" });
    });

    const list = queryClient.getQueryData<Vehicle[]>(fleetKeys.list("vehicle"));
    expect(list?.map((row) => [row.id, row.version, row.name])).toEqual([
      ["veh-1", 4, "Renamed truck"],
      ["veh-2", 3, "Second truck"],
    ]);
    expect(queryClient.getQueryData<EntityOption>(entityKeys.detail("vehicle", vehicle.id))?.name).toBe("Renamed truck");
    expect(queryClient.getQueryState(fleetKeys.list("vehicle"))?.isInvalidated).toBe(true);
  });

  it("drops a deleted record from the settings list", async () => {
    mocks.deleteOperatorFn.mockResolvedValue({ success: true, data: { id: operator.id } });
    queryClient.setQueryData(fleetKeys.list("operator"), [operator]);
    const remove = await renderHook(() => useDeleteOperator());

    await act(async () => {
      await remove.current.mutateAsync({ operatorId: operator.id, expectedVersion: 1 });
    });

    expect(queryClient.getQueryData(fleetKeys.list("operator"))).toEqual([]);
  });
});
