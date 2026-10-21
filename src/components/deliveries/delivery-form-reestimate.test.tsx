// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Delivery } from "@/db/schema";
import { DeliveryForm } from "./delivery-form";

const ids = vi.hoisted(() => ({
  delivery: "00000000-0000-4000-8000-000000000001", bin: "00000000-0000-4000-8000-000000000002",
  facility: "00000000-0000-4000-8000-000000000003", order: "00000000-0000-4000-8000-000000000004",
  movement: "00000000-0000-4000-8000-000000000005", a: "00000000-0000-4000-8000-00000000000a", b: "00000000-0000-4000-8000-00000000000b",
}));
const state = vi.hoisted(() => ({ preview: vi.fn(), drift: vi.fn(), refresh: vi.fn(), lockedReason: null as string | null }));
vi.mock("@/fn/transport-distance-refresh", () => ({
  getTransportDistanceDriftFn: (...args: unknown[]) => state.drift(...args),
  refreshDeliveryDistanceFn: (...args: unknown[]) => state.refresh(...args),
  refreshFeedstockDistanceFn: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/fn/output-stock", () => ({
  getOutputStockHistoryFn: async () => ({ success: true, data: [{ id: ids.movement, kind: "delivery", deliveryId: ids.delivery,
    editLockedReason: state.lockedReason, sources: [{ layerId: ids.a, moisturePercent: 20 }] }] }),
  getOutputSubBinsFn: async () => ({ success: true, data: { stockMode: "split", drawOrder: "oldest_first", subBins: [ids.a, ids.b].map((layerId, index) => ({
    layerId, code: index === 0 ? "P1" : "P2", placedAt: "2026-09-12T12:00:00.000Z", dryMassKg: 1000, solidsKg: 1000,
    wetEstimateKg: 1250, moisturePercent: 20, basis: null, recentMovements: [], ingredients: [],
  })) } }),
  previewOutputStockFn: (...args: unknown[]) => state.preview(...args),
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: ids.facility }), useFacilityClock: () => ({ timeZone: "UTC" }),
}));
vi.mock("@/hooks/use-facilities", () => ({ useFacility: () => ({ data: null }) }));
vi.mock("@/hooks/use-orders", async importOriginal => ({
  ...await importOriginal<typeof import("@/hooks/use-orders")>(), useOrdersForSelect: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: [] }), useEntityById: () => ({ data: null }),
}));
vi.mock("@/components/transport-legs", () => ({ TransportRoutePreview: () => null }));
vi.mock("./delivery-stock-details", () => ({ DeliveryStockDetails: () => null }));
vi.mock("./delivery-trailing-sections", () => ({ DeliveryEvidenceSection: () => null }));
// The real preview renders the notice; here it only hands back the delivery form's action.
vi.mock("@/components/storage-locations/output-stock-preview", () => ({
  OutputStockPreview: ({ preview, onMeasureAgain }: { preview: { reestimate?: unknown }; onMeasureAgain?: () => void }) =>
    preview.reestimate ? <button type="button" onClick={onMeasureAgain}>Edit the moisture</button> : null,
}));

const delivery = { id: ids.delivery, facilityId: ids.facility, orderId: ids.order, storageLocationId: ids.bin,
  deliveryDate: new Date("2026-10-01T12:00:00Z"), deliveredWetMassKg: 100, moistureContentPercent: 20,
  distanceKmOverride: null, distanceSource: null } as Delivery;
const reestimate = { moisturePercent: 50, stayWetKg: 110, stayDryKg: 55 };
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.preview.mockReset().mockResolvedValue({ success: true, data: { basisFingerprint: "basis", blockingMessage: null, reestimate: null } });
  state.drift.mockReset().mockResolvedValue({ success: true, data: { entityType: "delivery", entityId: ids.delivery, expectedVersion: 3, distanceKmOverride: null,
    recordedDistanceKm: 42, recordedDistanceSource: "manual", currentDistanceKm: 42, currentDistanceSource: "manual", locationId: "location",
    facilityId: ids.facility, isOverridden: false, hasDrift: false, hasSubmittedRemoval: false } });
  state.refresh.mockReset();
  state.lockedReason = null;
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); client.clear(); });

it("hands the delivery's re-estimate notice an action that returns to the moisture reading", async () => {
  render(<QueryClientProvider client={client}><DeliveryForm delivery={delivery} onSubmit={vi.fn()} /></QueryClientProvider>);
  const reading = await screen.findByRole("spinbutton", { name: /^P1 moisture/ }) as HTMLInputElement;
  await waitFor(() => expect(reading.value).toBe("20"));
  // A delivery drawn wetter than the bin: the preview says saving re-estimates what stays.
  state.preview.mockResolvedValue({ success: true, data: { basisFingerprint: "basis", blockingMessage: null, reestimate } });
  fireEvent.change(reading, { target: { value: "50" } });
  const action = await screen.findByRole("button", { name: "Edit the moisture" });
  screen.getByRole("button", { name: "Update delivery" }).focus();
  fireEvent.click(action);
  expect(document.activeElement).toBe(reading);
  // The notice already says what to do about a wetter reading, so the row drops its own advisory but keeps the estimate.
  expect(screen.queryByText(/points above/)).toBeNull();
  expect(screen.getByText("Estimated moisture: 20%")).toBeTruthy();
});

it("keeps a sub-bin reading's advisory when the delivery does not re-estimate", async () => {
  render(<QueryClientProvider client={client}><DeliveryForm delivery={delivery} onSubmit={vi.fn()} /></QueryClientProvider>);
  const reading = await screen.findByRole("spinbutton", { name: /^P1 moisture/ });
  fireEvent.change(reading, { target: { value: "50" } });
  expect(await screen.findByText(/50% is 30 points above the 20% estimate/)).toBeTruthy();
});

it("shows no re-estimate action while the delivery stays drier than the bin", async () => {
  render(<QueryClientProvider client={client}><DeliveryForm delivery={delivery} onSubmit={vi.fn()} /></QueryClientProvider>);
  const reading = await screen.findByRole("spinbutton", { name: /^P1 moisture/ });
  fireEvent.change(reading, { target: { value: "10" } });
  await waitFor(() => expect(state.preview).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Edit the moisture" })).toBeNull();
});
