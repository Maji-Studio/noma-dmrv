// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FACILITY_STORAGE_KEY,
  useFacilityContext,
  type FacilityContextValue,
} from "@/hooks/use-facility-context";
import { FacilityProvider } from "./facility-provider";

type Facility = FacilityContextValue["facilities"][number];

const state = vi.hoisted(() => ({
  facilities: [] as Facility[],
  lookup: undefined as Facility | undefined,
  lookupLoading: false,
  lookupError: false,
  organizationId: "org-1",
  useFacility: vi.fn(),
}));

vi.mock("@/hooks/use-facilities", () => ({
  useFacilities: () => ({ data: { items: state.facilities }, isLoading: false, isError: false }),
  useFacility: (id: string, enabled: boolean, organizationId: string) => {
    state.useFacility(id, enabled, organizationId);
    return {
      data: state.lookup?.id === id ? state.lookup : undefined,
      isLoading: enabled && state.lookupLoading,
      isError: enabled && state.lookupError,
    };
  },
}));
vi.mock("@/hooks/use-organization-settings", () => ({ useOrganizationDefaults: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    useSession: () => ({
      data: { session: { activeOrganizationId: state.organizationId } },
      isPending: false,
    }),
  },
}));

const FIRST = { id: "facility-first", name: "First", archivedAt: null } as Facility;
const STORED = { id: "facility-stored", name: "Stored", archivedAt: null } as Facility;

function renderProvider(searchParams = "?archivedFacility=facility-archived") {
  const onUrlUpdate = vi.fn();
  const view = renderHook(useFacilityContext, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        <FacilityProvider>{children}</FacilityProvider>
      </NuqsTestingAdapter>
    ),
  });
  return { ...view, onUrlUpdate };
}

beforeEach(() => {
  state.facilities = [FIRST];
  state.lookup = undefined;
  state.lookupLoading = false;
  state.lookupError = false;
  state.organizationId = "org-1";
  state.useFacility.mockClear();
  localStorage.clear();
  localStorage.setItem(FACILITY_STORAGE_KEY, STORED.id);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("FacilityProvider stored selection", () => {
  it("keeps the URL selection without rewriting storage after another tab changes it", async () => {
    state.facilities = [FIRST, STORED];
    const { result, onUrlUpdate } = renderProvider(`?facility=${FIRST.id}`);

    await waitFor(() => {
      expect(result.current.facilityId).toBe(FIRST.id);
      expect(result.current.isResolving).toBe(false);
      expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(FIRST.id);
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    localStorage.setItem(FACILITY_STORAGE_KEY, STORED.id);
    setItem.mockClear();

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: FACILITY_STORAGE_KEY,
        newValue: STORED.id,
      }));
    });

    expect(result.current.facilityId).toBe(FIRST.id);
    expect(result.current.selectedFacility).toBe(FIRST);
    expect(result.current.isResolving).toBe(false);
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(STORED.id);
  });

  it("does not read storage or resolve the stored facility during server rendering", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");

    function Selection() {
      const { facilityId, isResolving } = useFacilityContext();
      return <span>{facilityId}:{String(isResolving)}</span>;
    }

    const html = renderToString(
      <NuqsTestingAdapter searchParams="">
        <FacilityProvider><Selection /></FacilityProvider>
      </NuqsTestingAdapter>,
    );

    expect(getItem).not.toHaveBeenCalled();
    expect(state.useFacility).toHaveBeenCalledWith("", false, "org-1");
    expect(html).toContain(FIRST.id);
  });

  it("waits for a stored facility outside the first page and keeps it when verified", async () => {
    state.lookupLoading = true;
    const { result, rerender, onUrlUpdate } = renderProvider();

    expect(state.useFacility).toHaveBeenCalledWith(STORED.id, true, "org-1");
    expect(result.current.facilityId).toBeNull();
    expect(result.current.selectedFacility).toBeUndefined();
    expect(result.current.isResolving).toBe(true);
    expect(result.current.isLoading).toBe(true);
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(STORED.id);

    state.lookupLoading = false;
    state.lookup = STORED;
    rerender();

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get("facility")).toBe(STORED.id);
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get("archivedFacility")).toBe("facility-archived");
    expect(result.current.facilityId).toBe(STORED.id);
    expect(result.current.selectedFacility).toBe(STORED);
    expect(result.current.facilities).toEqual([STORED, FIRST]);
    expect(result.current.isResolving).toBe(false);
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(STORED.id);
  });

  it.each(["archived", "not found", "error"])("falls back when the stored facility is %s", async (outcome) => {
    state.lookupLoading = true;
    const { result, rerender, onUrlUpdate } = renderProvider();

    expect(state.useFacility).toHaveBeenCalledWith(STORED.id, true, "org-1");
    expect(result.current.isResolving).toBe(true);
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(STORED.id);

    state.lookupLoading = false;
    state.lookupError = outcome === "error";
    state.lookup = outcome === "archived" ? { ...STORED, archivedAt: new Date() } : undefined;
    rerender();

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(state.useFacility).toHaveBeenCalledWith(STORED.id, true, "org-1");
    expect(result.current.facilityId).toBe(FIRST.id);
    expect(result.current.selectedFacility).toBe(FIRST);
    expect(result.current.isResolving).toBe(false);
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get("facility")).toBe(FIRST.id);
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(FIRST.id);
  });

  it("keeps a stored facility already in the list without a lookup", async () => {
    state.facilities = [FIRST, STORED];
    const { result, onUrlUpdate } = renderProvider();

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(state.useFacility.mock.calls.every(([, enabled]) => !enabled)).toBe(true);
    expect(result.current.facilityId).toBe(STORED.id);
    expect(result.current.selectedFacility).toBe(STORED);
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(STORED.id);
  });

  it("clears storage for an empty list even if the stored facility was cached", () => {
    state.facilities = [];
    state.lookup = STORED;
    const { result, onUrlUpdate } = renderProvider();

    expect(result.current.facilityId).toBeNull();
    expect(result.current.selectedFacility).toBeUndefined();
    expect(result.current.isResolving).toBe(false);
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBeNull();
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(state.useFacility).toHaveBeenCalledWith(STORED.id, false, "org-1");
  });

  it("verifies the URL facility before the stored facility, including with an empty list", async () => {
    state.facilities = [];
    state.lookupLoading = true;
    const linked = { ...STORED, id: "facility-linked" };
    const { result, rerender, onUrlUpdate } = renderProvider(`?facility=${linked.id}`);

    expect(state.useFacility).toHaveBeenCalledWith(linked.id, true, "org-1");
    expect(result.current.facilityId).toBeNull();
    expect(result.current.isResolving).toBe(true);
    expect(onUrlUpdate).not.toHaveBeenCalled();

    state.lookupLoading = false;
    state.lookup = linked;
    rerender();

    await waitFor(() => expect(result.current.facilityId).toBe(linked.id));
    expect(result.current.selectedFacility).toBe(linked);
    expect(result.current.isResolving).toBe(false);
    // An empty list preserves a valid URL selection without rewriting storage.
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(STORED.id);
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it("falls back to a stored facility in the list when a URL lookup fails", async () => {
    state.facilities = [FIRST, STORED];
    const { result, onUrlUpdate } = renderProvider("?facility=facility-missing");

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(state.useFacility).toHaveBeenCalledWith("facility-missing", true, "org-1");
    expect(result.current.facilityId).toBe(STORED.id);
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(STORED.id);
  });

  it("clears a pending stored selection when the organization changes", async () => {
    state.lookupLoading = true;
    const { result, rerender, onUrlUpdate } = renderProvider();
    expect(result.current.isResolving).toBe(true);

    const other = { ...FIRST, id: "facility-other" };
    state.organizationId = "org-2";
    state.facilities = [other];
    state.lookupLoading = false;
    state.lookup = STORED;
    rerender();

    await waitFor(() => expect(result.current.facilityId).toBe(other.id));
    expect(result.current.activeOrganizationId).toBe("org-2");
    expect(result.current.selectedFacility).toBe(other);
    expect(localStorage.getItem(FACILITY_STORAGE_KEY)).toBe(other.id);
    expect(onUrlUpdate.mock.lastCall![0].searchParams.get("facility")).toBe(other.id);
  });
});
