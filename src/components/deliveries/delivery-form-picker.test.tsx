// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Delivery } from "@/db/schema";
import { DeliveryForm } from "./delivery-form";
import { useCreateCustomerLocation, useUpdateCustomerLocation, useDeleteCustomerLocation } from "@/hooks/use-customers";
import { orderKeys } from "@/hooks/use-orders";

const state = vi.hoisted(() => ({ locked: false, distance: 12, save: vi.fn(), read: vi.fn() }));
vi.mock("@/fn/orders", () => ({
  getOrdersForSelectFn: () => {
    state.read();
    return Promise.resolve({ success: true, data: [{ id: "order-one", name: "Order one", formulationId: "mix", destinationDistanceKm: state.distance, destinationDistanceSource: "manual" }] });
  },
}));
vi.mock("@/fn/customers", () => ({
  createCustomerLocationFn: (...args: unknown[]) => state.save(...args),
  updateCustomerLocationFn: (...args: unknown[]) => state.save(...args),
  deleteCustomerLocationFn: (...args: unknown[]) => state.save(...args),
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-one" }),
  useFacilityClock: () => ({ timeZone: "UTC" }),
}));
vi.mock("@/hooks/use-facilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-facilities")>(), useFacility: () => ({ data: null }),
}));
vi.mock("@/hooks/use-output-stock", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-output-stock")>(),
  useOutputStockHistory: () => ({ data: [{ id: "movement-one", kind: "delivery", deliveryId: "delivery-one", editLockedReason: state.locked ? "Locked because newer stock entries were recorded on this bin after it." : null }] }),
  useMatchingOutputBins: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-sub-bin-draw", () => ({ useSubBinDraw: () => ({ active: false, usesSingleMoisture: true, query: {} }) }));
vi.mock("@/hooks/use-output-draw-draft", () => ({ useOutputDrawDraft: () => ({
  preview: {}, estimate: null, gate: () => ({ canSave: true, submitDisabled: false }), beginSubmit: vi.fn(),
}) }));
vi.mock("@/components/transport-legs", () => ({ TransportRoutePreview: () => null }));
vi.mock("./delivery-stock-details", () => ({ DeliveryStockDetails: () => null }));
vi.mock("./delivery-trailing-sections", () => ({ DeliveryEvidenceSection: () => null }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: [{ id: "order-one", code: "ORD-1", name: "Order one" }, { id: "order-two", code: "ORD-2", name: "Order two" }] }),
  useEntityById: (entityType: string) => ({ data: entityType === "storageLocation"
    ? { id: "bin-one", code: "BIN-1", name: "Source bin" }
    : { id: "order-one", code: "ORD-1", name: "Order one" } }),
}));

const delivery = {
  id: "delivery-one", facilityId: "facility-one", orderId: "order-one", storageLocationId: "bin-one",
  deliveryDate: new Date("2026-10-01T12:00:00Z"), deliveredWetMassKg: 100,
  moistureContentPercent: 20, distanceKmOverride: null, distanceSource: null,
} as Delivery;
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  state.distance = 12;
  state.locked = false;
  vi.clearAllMocks();
  state.save.mockImplementation(async () => {
    state.distance = 34;
    return { success: true, data: { id: "location-one", customerId: "customer-one", version: 2 } };
  });
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); client.clear(); });

it("opens the existing delivery's order picker with only Edit and preserves the selected order", async () => {
  render(<DeliveryForm delivery={delivery} onSubmit={vi.fn()} />, { wrapper });
  const trigger = screen.getByRole("combobox", { name: /Order/ });
  fireEvent.click(trigger);
  expect(await screen.findByTestId("entity-select-edit")).toHaveProperty("textContent", "Edit Order one");
  const menu = screen.getByTestId("entity-select-listbox");
  expect(menu.children).toHaveLength(1);
  expect(within(menu).queryAllByRole("option")).toHaveLength(0);
  expect(screen.queryByTestId("entity-select-clear")).toBeNull();
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(trigger.textContent).toContain("Order one");
});

it("opens the existing delivery's source bin picker with only Edit and preserves its selection", async () => {
  render(<DeliveryForm delivery={delivery} onSubmit={vi.fn()} />, { wrapper });
  const trigger = screen.getByRole("combobox", { name: /Actual source bin/ });
  expect(trigger.hasAttribute("disabled")).toBe(false);
  expect(trigger.getAttribute("aria-readonly")).toBe("true");
  fireEvent.click(trigger);
  const menu = await screen.findByTestId("entity-select-listbox");
  expect(within(menu).getByTestId("entity-select-edit").textContent).toBe("Edit Source bin");
  expect(menu.children).toHaveLength(1);
  expect(within(menu).queryAllByRole("option")).toHaveLength(0);
  expect(screen.queryByTestId("entity-select-clear")).toBeNull();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(trigger.textContent).toBe("Source bin");
});

it.each(["create", "update", "delete"] as const)("refreshes the open delivery's inherited distance after a nested location %s without saving its parents", async (operation) => {
  const parentSave = vi.fn();
  client.setQueryData(orderKeys.select("other-facility"), []);
  render(<DeliveryForm delivery={delivery} onSubmit={parentSave} />, { wrapper });
  await waitFor(() => expect((screen.getByRole("spinbutton", { name: /One-way distance/ }) as HTMLInputElement).value).toBe("12"));
  const { result } = renderHook(() => ({
    create: useCreateCustomerLocation(), update: useUpdateCustomerLocation(), delete: useDeleteCustomerLocation("customer-one"),
  }), { wrapper });
  await act(async () => {
    if (operation === "create") await result.current.create.mutateAsync({ customerId: "customer-one", name: "Destination", country: "TZ", gpsLatitude: -7, gpsLongitude: 35, isDefault: false });
    else if (operation === "update") await result.current.update.mutateAsync({ locationId: "location-one", expectedVersion: 1, distanceFromFacilityKm: 34 });
    else await result.current.delete.mutateAsync({ locationId: "location-one", expectedVersion: 1 });
  });
  await waitFor(() => expect((screen.getByRole("spinbutton", { name: /One-way distance/ }) as HTMLInputElement).value).toBe("34"));
  expect(client.getQueryState(orderKeys.select("other-facility"))?.isInvalidated).toBe(true);
  expect(state.read).toHaveBeenCalledTimes(2);
  expect(parentSave).not.toHaveBeenCalled();
});

it("allows latest delivery mass edits and keeps its event time locked", () => {
  state.locked = false;
  render(<DeliveryForm delivery={delivery} onSubmit={vi.fn()} />, { wrapper });
  expect(screen.getByRole("spinbutton", { name: /Biochar product wet mass/ }).hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("spinbutton", { name: /^Biochar product moisture/ }).hasAttribute("disabled")).toBe(false);
  expect(screen.getByLabelText(/Delivery date and time/).hasAttribute("disabled")).toBe(true);
});

it("locks delivery mass and moisture with the newer-stock reason", () => {
  state.locked = true;
  render(<DeliveryForm delivery={delivery} onSubmit={vi.fn()} />, { wrapper });
  expect(screen.getByRole("spinbutton", { name: /Biochar product wet mass/ }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("spinbutton", { name: /^Biochar product moisture/ }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Locked because newer stock entries were recorded on this bin after it.")).toBeTruthy();
});

it("shows typed server refusals beside the delivery field", async () => {
  const validDelivery = { ...delivery, orderId: "00000000-0000-4000-8000-000000000001", storageLocationId: "00000000-0000-4000-8000-000000000002" };
  const onSubmit = vi.fn((_data, onError) => onError(Object.assign(new Error("Refused"), { issues: [{ path: ["deliveryDate"], code: "validation_failed", message: "Enter a time at or before now." }] })));
  const { container } = render(<DeliveryForm delivery={validDelivery} onSubmit={onSubmit} />, { wrapper });
  fireEvent.submit(container.querySelector("form")!);
  expect(await screen.findByText("Enter a time at or before now.")).toBeTruthy();
});

it("refuses a typed zero distance with the server's message", async () => {
  render(<DeliveryForm delivery={delivery} onSubmit={vi.fn()} />, { wrapper });
  fireEvent.change(screen.getByRole("spinbutton", { name: /One-way distance/ }), { target: { value: "0" } });
  expect(await screen.findByText("Distance must be greater than 0")).toBeTruthy();
});

it("reports a handled mass refusal and focuses its field", async () => {
  const validDelivery = { ...delivery, orderId: "00000000-0000-4000-8000-000000000001", storageLocationId: "00000000-0000-4000-8000-000000000002" };
  const onSubmit = vi.fn((_data, onError) => {
    expect(onError(Object.assign(new Error("Refused"), { issues: [{ path: ["deliveredWetMassKg"], code: "conflict", message: "Only 100 kg remains on this order." }] }))).toBe(true);
  });
  const { container } = render(<DeliveryForm delivery={validDelivery} onSubmit={onSubmit} />, { wrapper });
  fireEvent.submit(container.querySelector("form")!);
  await screen.findByText("Only 100 kg remains on this order.");
  expect(document.activeElement).toBe(screen.getByRole("spinbutton", { name: /Biochar product wet mass/ }));
});
