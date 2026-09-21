import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { OrderWithRelations } from "@/data-access/orders";

vi.mock("./matching-output-bins", () => ({ MatchingOutputBins: ({ facilityId, formulationId }: { facilityId: string; formulationId: string }) => <div data-stock-facility={facilityId} data-stock-formulation={formulationId} /> }));
import { OrderReadDetails } from "./order-read-details";

const order = { id: "order", facilityId: "saved-facility", formulationId: "saved-formulation", formulationName: "Saved formulation", customerName: "Saved customer", orderDate: new Date("2026-09-21"), quantityKg: 130.125, packaging: "loose", value: 500, currency: "TZS", fulfillmentStatus: "no_deliveries", deliveryCount: 0, deliveredCount: 0 } as unknown as OrderWithRelations;

describe("Order read detail level", () => {
  it("keeps saved requested values visible and loads only optional current stock in Detailed", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<OrderReadDetails key={order.id} order={order} />); });
    expect(renderer.root.findByProps({ type: "radio", value: "simple" }).props.checked).toBe(true);
    expect(renderer.root.findAllByProps({ "data-stock-facility": "saved-facility" })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain("Saved formulation");
    expect(JSON.stringify(renderer.toJSON())).toContain("Requested wet mass");
    expect(JSON.stringify(renderer.toJSON())).toContain("130.125 kg");
    await act(async () => { renderer.root.findByProps({ type: "radio", value: "detailed" }).props.onChange(); });
    expect(renderer.root.findAllByProps({ "data-stock-facility": "saved-facility", "data-stock-formulation": "saved-formulation" })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain("Current availability, not a stock snapshot from the order date.");
    await act(async () => { renderer.update(<OrderReadDetails key="another" order={{ ...order, id: "another" }} />); });
    expect(renderer.root.findByProps({ type: "radio", value: "simple" }).props.checked).toBe(true);
    await act(async () => renderer.unmount());
  });
});
