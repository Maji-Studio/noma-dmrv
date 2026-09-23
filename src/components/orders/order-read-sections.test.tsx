import type { ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import type { OrderWithRelations } from "@/data-access/orders";

vi.mock("./matching-output-bins", () => ({
  MatchingOutputBins: ({ facilityId, formulationId }: { facilityId: string; formulationId: string }) => (
    <div data-stock-facility={facilityId} data-stock-formulation={formulationId}>Matching bins</div>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ children, label }: { children: ReactNode; label: string }) => <span aria-label={label}>{children}</span>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

import { orderSheetSections } from "./order-read-sections";

const order = {
  id: "order",
  facilityId: "saved-facility",
  formulationId: "saved-formulation",
  formulationName: "Saved formulation",
  customerName: "Saved customer",
  customerLocationName: "North field",
  orderDate: new Date("2026-09-21"),
  quantityKg: 130.125,
  packaging: "loose",
  value: 500,
  currency: "TZS",
  fulfillmentStatus: "no_deliveries",
  deliveryCount: 0,
  deliveredCount: 0,
  deliveredWetMassKg: 0,
} as unknown as OrderWithRelations;

function visibleText(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visibleText).join(" ");
}

async function renderSheet(value: OrderWithRelations) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <FormDetailProvider scope={value.id}>
        <FormDetailControl />
        <EntitySideSheetSections numbered sections={orderSheetSections(value)} />
      </FormDetailProvider>,
    );
  });
  const switchTo = async (level: "simple" | "detailed") => {
    await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === level)!.props.onChange());
  };
  return { renderer, switchTo };
}

describe("Order read view levels", () => {
  it("shows the saved order in Simple and mounts current stock only in Detailed", async () => {
    const { renderer, switchTo } = await renderSheet(order);
    const simple = visibleText(renderer.root);
    expect(simple).toContain("Saved formulation");
    expect(simple).toContain("Requested wet mass (kg)");
    // Save precision: three decimals, not the display default.
    expect(simple).toContain("130.125 kg");
    expect(simple).not.toContain("Matching stock");
    expect(simple).not.toContain("Fulfillment");
    expect(renderer.root.findAllByProps({ "data-stock-facility": "saved-facility" })).toHaveLength(0);

    await switchTo("detailed");
    const detailed = visibleText(renderer.root);
    expect(renderer.root.findAllByProps({ "data-stock-facility": "saved-facility", "data-stock-formulation": "saved-formulation" })).toHaveLength(1);
    expect(detailed).toContain("Matching stock");
    expect(detailed).toContain("Fulfillment");
    expect(detailed).not.toContain("Delivered");
    expect(detailed).not.toContain("Current availability");
    await act(async () => renderer.unmount());
  });

  it("keeps the delivered figure in Simple once deliveries exist", async () => {
    const { renderer, switchTo } = await renderSheet({ ...order, fulfillmentStatus: "partial", deliveryCount: 2, deliveredCount: 1, deliveredWetMassKg: 60.5 } as OrderWithRelations);
    const simple = visibleText(renderer.root);
    expect(simple).toContain("Delivered");
    expect(simple).toContain("60.5 of 130.125 kg wet");
    expect(simple).not.toContain("1 of 2 deliveries");
    expect(simple).not.toContain("Partial");
    await switchTo("detailed");
    expect(visibleText(renderer.root)).toContain("1 of 2 deliveries");
    await act(async () => renderer.unmount());
  });
});
