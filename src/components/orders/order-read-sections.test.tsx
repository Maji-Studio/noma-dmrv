// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import type { OrderWithRelations } from "@/data-access/orders";

afterEach(cleanup);

vi.mock("./matching-output-bins", () => ({
  MatchingOutputBins: ({ facilityId, formulationId }: { facilityId: string; formulationId: string }) => (
    <div data-stock-facility={facilityId} data-stock-formulation={formulationId}>Matching bins</div>
  ),
}));
vi.mock("./order-location-read", () => ({
  OrderLocationRead: () => <div>Delivery location</div>,
}));

import { orderSheetSections } from "./order-read-sections";

const order = {
  id: "order",
  facilityId: "saved-facility",
  formulationId: "saved-formulation",
  formulationName: "Saved formulation",
  customerName: "Saved customer",
  customerId: "saved-customer",
  customerLocationId: "saved-location",
  customerLocationName: "North field",
  orderDate: new Date("2026-09-21"),
  quantityKg: 130.125,
  packaging: "loose",
  fulfillmentStatus: "no_deliveries",
  deliveryCount: 0,
  deliveredWetMassKg: 0,
} as unknown as OrderWithRelations;

function renderSheet(value: OrderWithRelations) {
  return render(<EntitySideSheetSections numbered sections={orderSheetSections(value)} />);
}

describe("Order read view", () => {
  it("shows the saved order, matching stock and fulfillment", () => {
    const { container } = renderSheet(order);
    const shown = container.textContent ?? "";
    expect(shown).toContain("Saved formulation");
    expect(shown).toContain("Delivery location");
    expect(shown).toContain("Requested wet mass (kg)");
    // Save precision: three decimals, not the display default.
    expect(shown).toContain("130.125 kg");
    expect(shown).not.toContain("Currency");
    expect(shown).not.toContain("Value");
    expect(shown).toContain("Matching stock");
    expect(shown).toContain("Fulfillment");
    expect(shown).toContain("No deliveries");
    expect(shown).not.toContain("Delivered");
    expect(container.querySelectorAll('[data-stock-facility="saved-facility"][data-stock-formulation="saved-formulation"]')).toHaveLength(1);
  });

  it("shows the delivered figure, delivery count and status once deliveries exist", () => {
    const { container } = renderSheet({ ...order, fulfillmentStatus: "partial", deliveryCount: 2, deliveredWetMassKg: 60.5 } as OrderWithRelations);
    const shown = container.textContent ?? "";
    expect(shown).toContain("60.5 of 130.125 kg wet mass");
    expect(shown).toContain("2 deliveries");
    expect(shown).toContain("Partial");
  });
});
