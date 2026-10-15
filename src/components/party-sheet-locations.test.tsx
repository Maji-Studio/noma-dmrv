// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act as domAct, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { customerSheetSections } from "./customers/customer-read-sections";
import { supplierSheetSections } from "./suppliers/supplier-read-sections";
import type { PartyLocationsQueryState } from "./party-locations-read-state";
import { DetailSpine } from "./ui/detail-panel";

const location = {
  name: "North field", country: "Tanzania", stateRegion: "Iringa",
  city: "Mafinga", address: "Plot 4", gpsLatitude: -8.3, gpsLongitude: 35.3,
  distanceFromFacilityKm: 12, defaultSoilTemperatureC: 24, isDefault: true,
};
const customer = { name: "Customer" } as Parameters<typeof customerSheetSections>[0];
const supplier = { name: "Supplier" } as Parameters<typeof supplierSheetSections>[0];

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(cleanup);

describe.each([
  { label: "Customer", sections: (query: PartyLocationsQueryState, partyId = "first-party") => customerSheetSections({ ...customer, id: partyId }, query) },
  { label: "Supplier", sections: (query: PartyLocationsQueryState, partyId = "first-party") => supplierSheetSections({ ...supplier, id: partyId }, query) },
])("$label sheet locations", ({ label, sections }) => {
  function query(overrides: Partial<PartyLocationsQueryState> = {}): PartyLocationsQueryState {
    return {
      data: undefined, isPending: true, isError: false, isFetching: true,
      refetch: vi.fn<PartyLocationsQueryState["refetch"]>(), ...overrides,
    };
  }

  it("renders every location value as pending, then renders the saved values", () => {
    const pending = sections(query()).filter(section => section.title === "Locations");
    expect(pending[0].fields.length).toBeGreaterThan(0);
    expect(pending[0].fields.every(field => field.pending)).toBe(true);
    const pendingHtml = renderToStaticMarkup(<DetailSpine sections={pending} />);
    expect(pendingHtml).toContain('data-pending="true"');
    expect(pendingHtml).toContain("animate-skeleton");
    expect(pendingHtml).not.toContain("Not recorded");

    const loaded = sections(query({ data: [location], isPending: false, isFetching: false }))
      .filter(section => section.title === "Locations");
    const loadedHtml = renderToStaticMarkup(<DetailSpine sections={loaded} />);
    expect(loadedHtml).toContain("North field");
    expect(loadedHtml).toContain("12 km");
    expect(loadedHtml).not.toContain("data-pending");
    expect(loadedHtml).not.toContain("Not recorded");
  });

  it("uses missing-value tokens only after an empty read succeeds", () => {
    const empty = sections(query({ data: [], isPending: false, isFetching: false }))
      .filter(section => section.title === "Locations");
    const html = renderToStaticMarkup(<DetailSpine sections={empty} />);
    expect(html).toContain("Not recorded");
    expect(html).not.toContain("data-pending");
  });

  it("settles a failed read and retries the locations query", async () => {
    const failedQuery = query({ isPending: false, isError: true, isFetching: false });
    const failed = sections(failedQuery);
    const locations = failed.filter(section => section.title === "Locations");
    expect(locations[0].fields).toEqual([]);
    expect(failed.flatMap(section => section.fields).some(field => field.pending)).toBe(false);
    const html = renderToStaticMarkup(<DetailSpine sections={locations} />);
    expect(html).toContain(`${label} locations unavailable`);
    expect(html).not.toContain("data-pending");
    expect(html).not.toContain("Not recorded");

    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<DetailSpine sections={locations} />);
    });
    await act(async () => {
      tree.root.findByType("button").props.onClick();
    });
    expect(failedQuery.refetch).toHaveBeenCalledOnce();
    await act(async () => tree.unmount());
  });

  it("keeps cached values visible with a warning after a refetch fails", () => {
    const cached = sections(query({ data: [location], isPending: false, isError: true, isFetching: true }))
      .filter(section => section.title === "Locations");
    const html = renderToStaticMarkup(<DetailSpine sections={cached} />);
    expect(html).toContain("North field");
    expect(html).toContain(`Could not refresh ${label.toLowerCase()} locations. Showing the last saved values.`);
    expect(html).not.toContain("locations unavailable");
    expect(html).not.toContain("data-pending");
    expect(html).toContain('disabled=""');
  });

  it.each(["success", "error", "pending"] as const)("keeps Retry focused and shows loading for the next party when the retry is %s", async (outcome) => {
    let resolveRetry!: (data: NonNullable<PartyLocationsQueryState["data"]>) => void;
    let rejectRetry!: (error: Error) => void;
    const retryResult = new Promise<NonNullable<PartyLocationsQueryState["data"]>>((resolve, reject) => {
      resolveRetry = resolve;
      rejectRetry = reject;
    });
    const loadLocations = vi.fn<() => Promise<NonNullable<PartyLocationsQueryState["data"]>>>()
      .mockRejectedValueOnce(new Error("Locations read failed"))
      .mockReturnValueOnce(retryResult)
      .mockReturnValue(new Promise(() => {}));
    const queryKey = ["locations", label, "first-party"];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    function Sheet({ partyId = "first-party" }: { partyId?: string }) {
      const locationsQuery = useQuery({ queryKey: ["locations", label, partyId], queryFn: loadLocations });
      return <DetailSpine sections={sections(locationsQuery, partyId)} />;
    }
    const view = render(<QueryClientProvider client={client}><Sheet /></QueryClientProvider>);
    const retry = await screen.findByRole<HTMLButtonElement>("button", { name: "Retry" });
    const notice = screen.getByRole("status");
    retry.focus();
    expect(document.activeElement).toBe(retry);

    fireEvent.click(retry);
    await waitFor(() => expect(loadLocations).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(queryKey)?.status).toBe("pending");
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(screen.getByRole("status")).toBe(notice);
    expect(document.activeElement).toBe(retry);
    expect(retry.disabled).toBe(true);
    expect(retry.getAttribute("aria-busy")).toBe("true");

    if (outcome !== "pending") {
      await domAct(async () => {
        if (outcome === "success") resolveRetry([location]);
        else rejectRetry(new Error("Locations retry failed"));
      });
    }
    if (outcome === "success") {
      await screen.findByText(location.name);
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(screen.queryByText(/locations unavailable/)).toBeNull();
    } else if (outcome === "error") {
      await waitFor(() => expect(retry.disabled).toBe(false));
      expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
      expect(document.activeElement).toBe(retry);
      expect(retry.hasAttribute("aria-busy")).toBe(false);
    }
    view.rerender(<QueryClientProvider client={client}><Sheet partyId="next-party" /></QueryClientProvider>);
    expect(screen.getByRole("status").textContent).toBe(`Loading ${label.toLowerCase()} locations…`);
    expect(screen.queryByText(/locations unavailable/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    view.unmount();
    client.clear();
  });
});
