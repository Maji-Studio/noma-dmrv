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
  it("shows the saved order, matching stock and fulfillment at both levels", async () => {
    const { renderer, switchTo } = await renderSheet(order);
    for (const level of ["simple", "detailed"] as const) {
      await switchTo(level);
      const shown = visibleText(renderer.root);
      expect(shown).toContain("Saved formulation");
      expect(shown).toContain("Requested wet mass (kg)");
      // Save precision: three decimals, not the display default.
      expect(shown).toContain("130.125 kg");
      expect(shown).not.toContain("Currency");
      expect(shown).not.toContain("Value");
      expect(shown).toContain("Matching stock");
      expect(shown).toContain("Fulfillment");
      expect(shown).toContain("No deliveries");
      expect(shown).not.toContain("Delivered");
      expect(renderer.root.findAllByProps({ "data-stock-facility": "saved-facility", "data-stock-formulation": "saved-formulation" })).toHaveLength(1);
    }
    await act(async () => renderer.unmount());
  });

  it("shows the delivered figure, delivery count and status at both levels once deliveries exist", async () => {
    const { renderer, switchTo } = await renderSheet({ ...order, fulfillmentStatus: "partial", deliveryCount: 2, deliveredWetMassKg: 60.5 } as OrderWithRelations);
    for (const level of ["simple", "detailed"] as const) {
      await switchTo(level);
      const shown = visibleText(renderer.root);
      expect(shown).toContain("60.5 of 130.125 kg wet");
      expect(shown).toContain("2 deliveries");
      expect(shown).toContain("Partial");
    }
    await act(async () => renderer.unmount());
  });
});
