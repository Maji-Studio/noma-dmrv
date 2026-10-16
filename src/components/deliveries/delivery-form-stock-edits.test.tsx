// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Delivery } from "@/db/schema";
import { DeliveryForm } from "./delivery-form";

const ids = vi.hoisted(() => ({
  delivery: "00000000-0000-4000-8000-000000000001", bin: "00000000-0000-4000-8000-000000000002",
  facility: "00000000-0000-4000-8000-000000000003", order: "00000000-0000-4000-8000-000000000004",
  movement: "00000000-0000-4000-8000-000000000005", a: "00000000-0000-4000-8000-00000000000a", b: "00000000-0000-4000-8000-00000000000b",
}));
const state = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("@/fn/output-stock", () => ({
  getOutputStockHistoryFn: async () => ({ success: true, data: [{ id: ids.movement, kind: "delivery", deliveryId: ids.delivery,
    editLockedReason: null, sources: [{ layerId: ids.a, moisturePercent: 20 }] }] }),
  getOutputSubBinsFn: async () => ({ success: true, data: { stockMode: "split", drawOrder: "oldest_first", subBins: [ids.a, ids.b].map((layerId, index) => ({
    layerId, code: index === 0 ? "P1" : "P2", placedAt: "2026-09-12T12:00:00.000Z", dryMassKg: 1000, solidsKg: 1000,
    wetEstimateKg: 1250, moisturePercent: 20, basis: null, recentMovements: [],
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
vi.mock("@/components/storage-locations/output-stock-preview", () => ({ OutputStockPreview: () => null }));

const delivery = { id: ids.delivery, facilityId: ids.facility, orderId: ids.order, storageLocationId: ids.bin,
  deliveryDate: new Date("2026-10-01T12:00:00Z"), deliveredWetMassKg: 100, moistureContentPercent: 20,
  distanceKmOverride: null, distanceSource: null } as Delivery;
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.preview.mockReset().mockResolvedValue({ success: true, data: { basisFingerprint: "fresh-basis", blockingMessage: null } });
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); client.clear(); });

async function open(record = delivery) {
  const save = vi.fn();
  const view = render(<QueryClientProvider client={client}><DeliveryForm delivery={record} onSubmit={save} /></QueryClientProvider>);
  const reading = await screen.findByRole("spinbutton", { name: /^P1 moisture/ });
  await waitFor(() => expect((reading as HTMLInputElement).value).toBe("20"));
  return { save, reading, form: view.container.querySelector("form")!, button: screen.getByRole("button", { name: "Update delivery" }) };
}

it.each(["", "100"])("refuses to save an unchanged mass with a split reading of '%s'", async raw => {
  const { save, reading, form } = await open();
  fireEvent.change(reading, { target: { value: raw } });
  await act(async () => { fireEvent.submit(form); });
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(raw ? "Enter a moisture from 0 to less than 100%." : "Enter the measured moisture.")).toBeTruthy();
});

it("refuses to save an unchanged mass with a selected sub-bin the load never reaches", async () => {
  const { save, form, button } = await open();
  fireEvent.click(screen.getByRole("button", { name: "Change the sub-bins in this load" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /^P2/ }));
  fireEvent.click(screen.getByRole("button", { name: "Move P2 up" }));
  fireEvent.click(screen.getByRole("button", { name: "Use this order" }));
  await waitFor(() => expect(screen.getByText(/Untick it under Change/)).toBeTruthy());
  await act(async () => { fireEvent.submit(form); });
  expect(save).not.toHaveBeenCalled();
  expect(button.hasAttribute("disabled")).toBe(true);
});

it("waits for the changed reading's preview before saving the correction", async () => {
  const { save, reading, form, button } = await open();
  let resolvePreview!: (value: unknown) => void;
  state.preview.mockImplementation(() => new Promise(resolve => { resolvePreview = resolve; }));
  fireEvent.change(reading, { target: { value: "30" } });
  await waitFor(() => expect(state.preview).toHaveBeenCalledWith(expect.objectContaining({ sources: [{ layerId: ids.a, moisturePercent: 30 }] })));
  expect(button.hasAttribute("disabled")).toBe(true);
  await act(async () => { fireEvent.submit(form); });
  expect(save).not.toHaveBeenCalled();
  await act(async () => { resolvePreview({ success: true, data: { basisFingerprint: "changed-basis", blockingMessage: null } }); });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ sources: [{ layerId: ids.a, moisturePercent: 30 }],
    correctsMovementId: ids.movement, basisFingerprint: "changed-basis" }), expect.any(Function), undefined);
});

it("allows a metadata-only save without requesting a stock correction preview", async () => {
  const { save, form } = await open();
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ deliveredWetMassKg: 100, moistureContentPercent: 20, sources: undefined, correctsMovementId: undefined }), expect.any(Function), undefined);
  expect(state.preview).not.toHaveBeenCalled();
});

it("clears a legacy zero distance override when saving a metadata edit", async () => {
  const { save, form } = await open({ ...delivery, distanceKmOverride: 0, distanceSource: "manual", distanceNote: "Legacy override note" });
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ distanceKmOverride: null, distanceNote: null }), expect.any(Function), undefined);
});

// The two-state distance field's request mapping (GLOSSARY "Distance override").
const distanceInput = () => screen.getByRole("spinbutton", { name: /One-way distance/ }) as HTMLInputElement;
const overridden = { ...delivery, distanceKmOverride: 60, distanceSource: "document", distanceNote: "Detour" } as Delivery;

it("shows the derived distance read-only and omits it on save", async () => {
  const { save, form } = await open({ ...delivery, recordedDistanceKm: 42, recordedDistanceSource: "manual" } as Delivery);
  expect(distanceInput().readOnly).toBe(true);
  expect(distanceInput().value).toBe("42");
  expect(screen.getByText("Location default")).toBeTruthy();
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    distanceKmOverride: undefined, distanceSource: undefined, distanceNote: undefined,
  }), expect.any(Function), undefined);
});

it("sets an override with its source and note", async () => {
  const { save, form } = await open({ ...delivery, recordedDistanceKm: 42, recordedDistanceSource: "manual" } as Delivery);
  fireEvent.click(screen.getByRole("button", { name: "Override" }));
  expect(distanceInput().readOnly).toBe(false);
  expect(document.activeElement).toBe(distanceInput());
  fireEvent.change(distanceInput(), { target: { value: "60" } });
  fireEvent.change(screen.getByRole("combobox", { name: /Distance source/ }), { target: { value: "document" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Distance note/ }), { target: { value: "Bridge closed" } });
  expect(screen.getByText("Clearing returns to the location default, 42 km.")).toBeTruthy();
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    distanceKmOverride: 60, distanceSource: "document", distanceNote: "Bridge closed",
  }), expect.any(Function), undefined);
});

it("refuses an override with no distance", async () => {
  const { save, form } = await open();
  fireEvent.click(screen.getByRole("button", { name: "Override" }));
  await act(async () => { fireEvent.submit(form); });
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText("Enter a distance, or clear the override.")).toBeTruthy();
});

it("preserves a saved override by omitting it", async () => {
  const { save, form } = await open(overridden);
  expect(distanceInput().value).toBe("60");
  expect(screen.getByText("Override")).toBeTruthy();
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    distanceKmOverride: undefined, distanceSource: undefined, distanceNote: undefined,
  }), expect.any(Function), undefined);
});

it("clears a saved override with null and returns to the derived distance", async () => {
  const { save, form } = await open({ ...overridden, recordedDistanceKm: 42, recordedDistanceSource: "manual" } as Delivery);
  fireEvent.click(screen.getByRole("button", { name: "Clear override" }));
  expect(distanceInput().readOnly).toBe(true);
  expect(distanceInput().value).toBe("42");
  expect(screen.queryByRole("combobox", { name: /Distance source/ })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Override" }));
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    distanceKmOverride: null, distanceSource: undefined, distanceNote: null,
  }), expect.any(Function), undefined);
});
