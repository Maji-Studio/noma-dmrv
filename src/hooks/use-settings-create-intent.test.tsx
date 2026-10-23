// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateFacility } from "./use-facilities";
import { useCreateReactor } from "./use-reactors";
import { useCreateStorageLocation } from "./use-storage-locations";
import { useCreateFeedstockType } from "./use-feedstock-types";
import { useStartNewProductionProcess } from "./use-production-processes";

const actions = vi.hoisted(() => ({ facility: vi.fn(), reactor: vi.fn(), bin: vi.fn(), type: vi.fn(), process: vi.fn() }));
vi.mock("@/fn/facilities", () => ({ createFacilityFn: actions.facility }));
vi.mock("@/fn/reactors", () => ({ createReactorFn: actions.reactor }));
vi.mock("@/fn/storage-locations", () => ({ createStorageLocationFn: actions.bin }));
vi.mock("@/fn/feedstock-types", () => ({ createFeedstockTypeFn: actions.type }));
vi.mock("@/fn/production-processes", () => ({ startNewProductionProcessFn: actions.process }));
vi.mock("@/lib/read-api/client", () => ({}));

const ID = "11111111-1111-4111-8111-111111111111";
const cases = [
  { name: "facility", useCreate: useCreateFacility, action: actions.facility, input: { name: "Facility", country: "CH", gpsLatitude: 0, gpsLongitude: 0, timezone: "UTC" } },
  { name: "reactor", useCreate: useCreateReactor, action: actions.reactor, input: { identifier: "Reactor", facilityId: ID, reactorType: "batch" } },
  { name: "storage bin", useCreate: useCreateStorageLocation, action: actions.bin, input: { name: "Bin", facilityId: ID, type: "biochar_bin" } },
  { name: "feedstock type", useCreate: useCreateFeedstockType, action: actions.type, input: { name: "Type", category: "forestry", usage: "pyrolysis" } },
  { name: "production process", useCreate: useStartNewProductionProcess, action: actions.process, input: { facilityId: ID, feedstockTypeId: ID } },
];
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe.each(cases)("$name create draft", ({ useCreate, action, input }) => {
  it("retains the key on failure and rerender, rotates on startDraft and success", async () => {
    action.mockResolvedValue({ success: false, error: "Try again" });
    const { result, rerender } = renderHook(() => useCreate(), { wrapper });
    const fail = async () => {
      await act(async () => { await expect(result.current.mutateAsync(input as never)).rejects.toThrow("Try again"); });
    };
    await fail();
    rerender();
    await fail();
    act(() => result.current.startDraft());
    await fail();
    action.mockResolvedValue({ success: true, data: { id: ID, facilityId: ID } });
    await act(async () => { await result.current.mutateAsync(input as never); });
    await act(async () => { await result.current.mutateAsync(input as never); });
    const keys = action.mock.calls.map(([, options]) => options.intentKey);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).toBe(keys[2]);
    expect(keys[4]).not.toBe(keys[3]);
    for (const [values] of action.mock.calls) expect(values).toEqual(input);
  });
});
