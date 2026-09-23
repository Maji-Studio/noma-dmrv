import type { ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";

vi.mock("@/components/transport-legs", () => ({ TransportLegsSummary: () => <span>Transport legs</span> }));
vi.mock("@/components/ui/entity-detail-value", () => ({ EntityDetailValue: () => <span>Manure store</span> }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ children, label }: { children: ReactNode; label: string }) => <span aria-label={label}>{children}</span>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

import { productSheetSections, savedProductComposition } from "./product-read-details";

const product = {
  id: "product", facilityId: "facility", placedAt: "2026-09-21", massKg: 350, waterAddedKg: 50,
  moistureContentPercent: 5, sourceAllocatedDryMassKg: 200, densityKgM3: 300,
  formulation: { id: "formulation", name: "Biochar with manure" },
  storageLocation: { id: "destination", name: "Product store" },
  sourceBiocharStorageLocation: { id: "source", name: "Biochar store" },
  composition: { ingredients: [{ formulationIngredientId: "ingredient", feedstockTypeId: "feedstock", feedstockTypeName: "Chicken manure", feedstockTypeCategory: "manure", massKg: 100, massDryKg: 80, moistureContentPercent: 50 }] },
} as unknown as BiocharProductWithRelations;

describe("Saved product composition", () => {
  it("uses saved source and ingredient allocations even when moisture implies different masses", () => {
    const composition = savedProductComposition(product);
    expect(composition.sourceWetKg).toBe(250);
    expect(composition.sourceDryKg).toBe(200);
    expect(composition.sourceTotalKg).toBe(300);
    expect(composition.productTotalKg).toBe(400);
    expect(composition.productComponents.map(component => component.massKg)).toEqual([200, 80, 70, 50]);
    expect(savedProductComposition({ ...product, moistureContentPercent: 60 }).sourceDryKg).toBe(200);
  });

  it("uses the canonical legacy source derivation only when no allocation was recorded", () => {
    expect(savedProductComposition({ ...product, sourceAllocatedDryMassKg: null }).sourceDryKg).toBe(237.5);
  });

  it("does not reconstruct missing saved ingredient dry snapshots from current moisture", () => {
    const missing = { ...product, composition: { ingredients: [{ ...(product.composition as { ingredients: Record<string, unknown>[] }).ingredients[0], massDryKg: null }] } };
    expect(savedProductComposition(missing).productComponents.filter(component => component.kind === "ingredient" || component.kind === "water").map(component => component.massKg)).toEqual([null, null]);
  });
});

function visibleText(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visibleText).join(" ");
}
const text = (node: ReactTestInstance) => visibleText(node).replace(/\s+/g, " ");

describe("Product read view levels", () => {
  it("keeps saved fields and the composition picture in Simple, and adds dry rows, ledger and transport in Detailed", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <FormDetailProvider scope="product">
          <FormDetailControl />
          <EntitySideSheetSections numbered sections={productSheetSections(product)} />
        </FormDetailProvider>,
      );
    });
    const simple = text(renderer.root);
    expect(simple).toContain("Product store");
    expect(simple).toContain("Chicken manure wet mass (kg)");
    expect(simple).toContain("Product composition");
    // Headline and key at save precision, from the saved allocation.
    expect(simple).toContain("400 kg");
    expect(simple).toContain("Dry biochar 200 kg");
    expect(simple).toContain("Chicken manure (dry) 80 kg");
    expect(renderer.root.findAll(node => node.props.role === "img")).toHaveLength(1);
    for (const hidden of ["Dry biochar (kg)", "dry solids (kg)", "% of total", "Show calculation", "Derived transport", "Transport legs"]) {
      expect(simple).not.toContain(hidden);
    }

    await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
    const detailed = text(renderer.root);
    expect(detailed).toContain("Dry biochar (kg)");
    expect(detailed).toContain("Chicken manure dry solids (kg)");
    expect(detailed).toContain("% of total");
    expect(detailed).toContain("Derived transport");
    const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
    await act(async () => disclosure.props.onClick());
    const disclosed = text(renderer.root);
    expect(disclosed).toContain("Source biochar (wet)");
    expect(disclosed).toContain("source allocation saved with the product");
    expect(disclosed).toContain("snapshot saved with the product");
    await act(async () => renderer.unmount());
  });

  it("shows masses at save precision and omits the bar when a saved part is missing", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const precise = { ...product, waterAddedKg: 50.125, composition: { ingredients: [{ ...(product.composition as { ingredients: Record<string, unknown>[] }).ingredients[0], massDryKg: null }] } } as unknown as BiocharProductWithRelations;
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EntitySideSheetSections sections={productSheetSections(precise)} />);
    });
    const shown = text(renderer.root);
    expect(shown).toContain("50.125 kg");
    expect(shown).toContain("Chicken manure (dry) Not available");
    expect(renderer.root.findAll(node => node.props.role === "img")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});
