import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";

vi.mock("@/components/storage-locations/bin-movement-history-modal", () => ({ BinMovementHistoryModal: () => null }));
vi.mock("@/components/storage-locations/output-stock-history", () => ({ OutputStockHistory: () => null }));
vi.mock("@/components/transport-legs", () => ({ TransportLegsSummary: () => null }));
vi.mock("@/components/ui/entity-detail-value", () => ({ EntityDetailValue: () => null }));

import { ProductReadDetails, savedProductComposition } from "./product-read-details";

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

describe("Product read detail level", () => {
  it("defaults to Simple, keeps saved fields visible, and resets when the entity changes", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ProductReadDetails key={product.id} product={product} />); });
    expect(renderer.root.findAllByProps({ "aria-label": "Product composition" })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain("Product store");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("400 kg");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Wet product");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Dry biochar");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Derived transport");
    await act(async () => { renderer.root.findByProps({ type: "radio", value: "detailed" }).props.onChange(); });
    expect(renderer.root.findAllByProps({ "aria-label": "Product composition" })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain("Chicken manure (dry)");
    expect(renderer.root.findAllByProps({ "aria-label": "Source composition" })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ "aria-label": "Chicken manure composition" })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain("400 kg");
    await act(async () => { renderer.update(<ProductReadDetails key="another" product={{ ...product, id: "another" }} />); });
    expect(renderer.root.findByProps({ type: "radio", value: "simple" }).props.checked).toBe(true);
    expect(renderer.root.findAllByProps({ "aria-label": "Product composition" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});
