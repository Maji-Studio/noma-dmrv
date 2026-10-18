// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportDistanceDrift } from "@/data-access/transport-distance-drift";
import { TransportDistanceDriftNotice } from "./transport-distance-drift";

const mocks = vi.hoisted(() => ({ drift: vi.fn(), refresh: vi.fn(), success: vi.fn() }));
vi.mock("@/fn/transport-distance-refresh", () => ({
  getTransportDistanceDriftFn: mocks.drift,
  refreshFeedstockDistanceFn: mocks.refresh,
  refreshDeliveryDistanceFn: mocks.refresh,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success, error: vi.fn() }) }));

const target = { entityType: "feedstock" as const, entityId: "11111111-1111-4111-8111-111111111111" };
const drift: TransportDistanceDrift = {
  ...target, expectedVersion: 3, distanceKmOverride: null,
  recordedDistanceKm: 42, recordedDistanceSource: "manual",
  currentDistanceKm: 55, currentDistanceSource: "map_estimate",
  locationId: "location", facilityId: "facility",
  isOverridden: false, hasDrift: true, hasSubmittedRemoval: false,
};

let client: QueryClient;
function renderNotice(value: Partial<TransportDistanceDrift> = {}) {
  mocks.drift.mockResolvedValue({ success: true, data: { ...drift, ...value } });
  return render(
    <QueryClientProvider client={client}>
      <TransportDistanceDriftNotice target={target} recordCode="FS-26-001" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); client.clear(); });

describe("TransportDistanceDriftNotice", () => {
  it("shows the recorded and current distances with a refresh action", async () => {
    renderNotice();
    expect(await screen.findByText("Location distance changed")).toBeTruthy();
    expect(screen.getByText("Recorded 42 km. Location now 55 km.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh from location" })).toBeTruthy();
  });

  it.each([
    ["an override", { isOverridden: true, distanceKmOverride: 70 }],
    ["no drift", { hasDrift: false, currentDistanceKm: 42 }],
    ["a location without a distance", { currentDistanceKm: null }],
  ])("shows nothing for %s", async (_label, value) => {
    renderNotice(value);
    await waitFor(() => expect(mocks.drift).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("transport-distance-drift")).toBeNull();
  });

  it("names a missing recorded distance", async () => {
    renderNotice({ recordedDistanceKm: null });
    expect(await screen.findByText("No distance recorded. Location now 55 km.")).toBeTruthy();
  });

  it("confirms and refreshes with the drift's version", async () => {
    mocks.refresh.mockResolvedValue({ success: true, data: { ...drift, expectedVersion: 4, recordedDistanceKm: 55, hasDrift: false } });
    renderNotice();
    fireEvent.click(await screen.findByRole("button", { name: "Refresh from location" }));
    expect(screen.getByText("Refresh distance from location?")).toBeTruthy();
    expect(screen.getByText("The recorded distance changes from 42 km to 55 km, the location's current distance, and the feedstock's transport is recalculated.")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Refresh" });
    await act(async () => { fireEvent.click(confirm); });
    expect(mocks.refresh).toHaveBeenCalledWith({ entityId: target.entityId, expectedVersion: 3 });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Distance for FS-26-001 refreshed to 55 km."));
  });

  it("blocks the refresh when the record feeds a submitted Removal", async () => {
    renderNotice({ hasSubmittedRemoval: true });
    fireEvent.click(await screen.findByRole("button", { name: "Refresh from location" }));
    expect(screen.getByText(/This feedstock feeds a submitted Removal, so its distance cannot be refreshed\./)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("keeps the dialog open with the server's refusal", async () => {
    const message = "The distance was not refreshed because its transport data belongs to a locked Removal. Ask an Organization Admin to review the linked Removal.";
    mocks.refresh.mockResolvedValue({ success: false, error: message });
    renderNotice();
    fireEvent.click(await screen.findByRole("button", { name: "Refresh from location" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText("Refresh distance from location?")).toBeTruthy();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
