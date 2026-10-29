// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkedRecordFacility } from "./use-linked-record-facility";

const context = vi.hoisted(() => ({
  activeOrganizationId: "org-a" as string | null,
  facilityId: "facility-a" as string | null,
  facilities: [{ id: "facility-a" }, { id: "facility-b" }],
  isLoading: false,
  setFacilityId: vi.fn(),
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => context }));
// The by-id facility read the hook runs for a facility outside the selectable list.
const lookup = vi.hoisted(() => ({
  calls: [] as Array<{ id: string; enabled: boolean; organizationId: string | null | undefined }>,
  refetch: vi.fn(),
  result: { data: undefined, isError: false } as { data?: { id: string; name: string; archivedAt: Date | null; timezone?: string }; isError: boolean; isRefetchError?: boolean; isFetching?: boolean; refetch?: () => void },
}));
vi.mock("@/hooks/use-facilities", () => ({
  useFacility: (id: string, enabled: boolean, organizationId?: string | null) => {
    lookup.calls.push({ id, enabled, organizationId });
    return enabled ? { refetch: lookup.refetch, isFetching: false, ...lookup.result } : { data: undefined, isError: false, refetch: lookup.refetch, isFetching: false };
  },
}));

beforeEach(() => {
  context.facilityId = "facility-a";
  context.facilities = [{ id: "facility-a" }, { id: "facility-b" }];
  context.isLoading = false;
  context.setFacilityId.mockClear();
  lookup.calls = [];
  lookup.refetch.mockClear();
  context.activeOrganizationId = "org-a";
  lookup.result = { data: undefined, isError: false };
});
afterEach(cleanup);

describe("useLinkedRecordFacility", () => {
  it("switches through the context setter and withholds the sheet until selection catches up", () => {
    const { result, rerender } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-b" }));
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
    expect(result.current.ready).toBe(false);
    rerender();
    expect(context.setFacilityId).toHaveBeenCalledTimes(1);
    context.facilityId = "facility-b";
    rerender();
    expect(result.current.ready).toBe(true);
  });

  it("does nothing when the record's facility is already active", () => {
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-a" }));
    expect(result.current.ready).toBe(true);
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });

  it("selects an available facility when there is no active facility", () => {
    context.facilityId = null;
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-b" }));
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
    expect(result.current.ready).toBe(false);
  });

  it("waits while the record is loading, even with cached data", () => {
    const { result, rerender } = renderHook(({ loading }) =>
      useLinkedRecordFacility({ facilityId: "facility-b" }, loading), { initialProps: { loading: true } });
    expect(context.setFacilityId).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
    rerender({ loading: false });
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
  });

  it("waits for the user's facilities before switching", () => {
    context.isLoading = true;
    const { result, rerender } = renderHook(() => useLinkedRecordFacility({ facilityId: "facility-b" }));
    expect(result.current.ready).toBe(false);
    expect(context.setFacilityId).not.toHaveBeenCalled();
    context.isLoading = false;
    rerender();
    expect(context.setFacilityId).toHaveBeenCalledExactlyOnceWith("facility-b");
  });

  it("never selects a facility outside the user's list, and shows the record where it is", () => {
    lookup.result = { data: { id: "far-facility", name: "Far", archivedAt: null }, isError: false };
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "far-facility" }));
    expect(result.current).toEqual({ ready: true, readOnly: null });
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });

  it("opens a record in an archived facility read only, without selecting the facility", () => {
    lookup.result = { data: { id: "archived-facility", name: "Mafinga", timezone: "Africa/Dar_es_Salaam", archivedAt: new Date("2026-10-29") }, isError: false };
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "archived-facility" }));
    expect(result.current).toEqual({ ready: true, readOnly: { reason: "archived", facilityId: "archived-facility", facilityName: "Mafinga", timezone: "Africa/Dar_es_Salaam" } });
    expect(context.setFacilityId).not.toHaveBeenCalled();
    expect(lookup.calls.at(-1)).toEqual({ id: "archived-facility", enabled: true, organizationId: "org-a" });
  });

  it("opens it read only when no facility is active", () => {
    context.facilityId = null;
    context.facilities = [];
    lookup.result = { data: { id: "archived-facility", name: "Mafinga", timezone: "Africa/Dar_es_Salaam", archivedAt: new Date("2026-10-29") }, isError: false };
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "archived-facility" }));
    expect(result.current.ready).toBe(true);
    expect(result.current.readOnly).toEqual({ reason: "archived", facilityId: "archived-facility", facilityName: "Mafinga", timezone: "Africa/Dar_es_Salaam" });
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });

  it("withholds the sheet until the facility read says whether it is archived", () => {
    const { result, rerender } = renderHook(() => useLinkedRecordFacility({ facilityId: "archived-facility" }));
    expect(result.current).toEqual({ ready: false, readOnly: null });
    lookup.result = { data: { id: "archived-facility", name: "Mafinga", timezone: "Africa/Dar_es_Salaam", archivedAt: new Date("2026-10-29") }, isError: false };
    rerender();
    expect(result.current.readOnly).toEqual({ reason: "archived", facilityId: "archived-facility", facilityName: "Mafinga", timezone: "Africa/Dar_es_Salaam" });
  });

  it("fails closed: a facility read that errors opens the record read only", () => {
    lookup.result = { data: undefined, isError: true };
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "unknown-facility" }));
    expect(result.current.ready).toBe(true);
    expect(result.current.readOnly).toMatchObject({ reason: "unchecked", facilityId: "unknown-facility", retrying: false });
    expect(context.setFacilityId).not.toHaveBeenCalled();
    if (result.current.readOnly?.reason !== "unchecked") throw new Error("expected unchecked");
    result.current.readOnly.retry();
    expect(lookup.refetch).toHaveBeenCalledOnce();
  });

  it("fails closed when a refetch errors while cached data still says active", () => {
    lookup.result = { data: { id: "far-facility", name: "Far", archivedAt: null }, isError: false, isRefetchError: true };
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "far-facility" }));
    expect(result.current.readOnly).toMatchObject({ reason: "unchecked", facilityId: "far-facility" });
  });

  it("fails closed without an active organization, since nothing can check the facility", () => {
    context.activeOrganizationId = null;
    const { result } = renderHook(() => useLinkedRecordFacility({ facilityId: "unknown-facility" }));
    expect(result.current.ready).toBe(true);
    expect(result.current.readOnly).toMatchObject({ reason: "unchecked", facilityId: "unknown-facility" });
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });

  it("never reads a selectable facility by id", () => {
    renderHook(() => useLinkedRecordFacility({ facilityId: "facility-b" }));
    expect(lookup.calls.every((call) => !call.enabled)).toBe(true);
  });

  it.each([null, undefined])("does nothing for an unloaded or missing record (%s)", (record) => {
    const { result } = renderHook(() => useLinkedRecordFacility(record));
    expect(result.current).toEqual({ ready: false, readOnly: null });
    expect(context.setFacilityId).not.toHaveBeenCalled();
  });
});
