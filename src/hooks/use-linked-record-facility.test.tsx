// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkedRecordFacility } from "./use-linked-record-facility";

const context = vi.hoisted(() => ({
  facilityId: "facility-a" as string | null,
  facilities: [{ id: "facility-a" }, { id: "facility-b" }],
  isLoading: false,
  setFacilityId: vi.fn(),
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => context }));

beforeEach(() => {
  context.facilityId = "facility-a";
  context.facilities = [{ id: "facility-a" }, { id: "facility-b" }];
  context.isLoading = false;
  context.setFacilityId.mockClear();
});
afterEach(cleanup);

describe("useLinkedRecordFacility", () => {
  it("switches through the context setter and withholds the sheet until selection catches up", () => {
    const { result, rerender } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-b" }));
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
    expect(result.current).toBe(false);
    rerender();
    expect(context.setFacilityId).toHaveBeenCalledTimes(1);
    context.facilityId = "facility-b";
    rerender();
    expect(result.current).toBe(true);
  });

  it("does nothing when the record's facility is already active", () => {
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-a" }));
    expect(result.current).toBe(true);
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });

  it("selects an available facility when there is no active facility", () => {
    context.facilityId = null;
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-b" }));
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
    expect(result.current).toBe(false);
  });

  it("waits while the record is loading, even with cached data", () => {
    const { result, rerender } = renderHook(({ loading }) =>
      useLinkedRecordFacility({ facilityId: "facility-b" }, loading), { initialProps: { loading: true } });
    expect(context.setFacilityId).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
    rerender({ loading: false });
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
  });

  it("waits for the user's facilities before switching", () => {
    context.isLoading = true;
    const { result, rerender } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-b" }));
    expect(result.current).toBe(false);
    expect(context.setFacilityId).not.toHaveBeenCalled();
    context.isLoading = false;
    rerender();
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
  });

  it("never selects a facility outside the user's list, and shows the record where it is", () => {
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "archived-facility" }));
    expect(result.current).toBe(true);
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });

  it.each([null, undefined])("does nothing for an unloaded or missing record (%s)", (record) => {
    const { result } = renderHook(() => useLinkedRecordFacility(record));
    expect(result.current).toBe(false);
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });
});
