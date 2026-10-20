// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";

vi.mock("@/components/ui/entity-detail-value", () => ({ EntityDetailValue: () => <span>Manure store</span> }));

afterEach(cleanup);

import { productSheetSections, savedProductComposition } from "./product-read-details";

const product = {
  id: "product", facilityId: "facility", placedAt: "2026-09-21T12:00:00.000Z", massKg: 350, waterAddedKg: 50,
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

/** Text as the operator reads it: elements are separated by a space. */
function text(node: Node): string {
  const walk = (current: Node): string => current.nodeType === Node.TEXT_NODE
    ? current.textContent ?? ""
    : [...current.childNodes].map(walk).join(" ");
  return walk(node).replace(/\s+/g, " ");
}

describe("Product read view", () => {
  it("shows saved fields, dry lines, the composition picture and transport inline, and the ledger behind the (i)", async () => {
    const { container } = render(<EntitySideSheetSections numbered sections={productSheetSections(product, "UTC")} />);
    const shown = text(container);
    expect(shown).toContain("Product store");
    expect(shown).toContain("Chicken manure wet mass (kg)");
    expect(shown).toContain("Product composition");
    // Headline and key at save precision, from the saved allocation.
    expect(shown).toContain("400 kg");
    expect(shown).toContain("200 kg dry biochar");
    // The form's split rule and labels: each ingredient as its solids, one pooled water.
    expect(shown).toContain("Chicken manure solids 80 kg");
    expect(shown).toContain("Water 70 kg");
    // The picture is the mass flow: each input, then the product it makes.
    const flows = container.querySelectorAll("[data-mass-flow]");
    expect(flows).toHaveLength(1);
    expect(text(flows[0]).trim()).toBe(
      "Biochar 250 kg wet mass Chicken manure 100 kg wet mass Water added 50 kg Wet biochar product 400 kg " +
        "Dry biochar 200 kg (50%) Chicken manure solids 80 kg (20%) Water 70 kg (18%) Water added 50 kg (12%)",
    );
    // Dry figures are data: a secondary line under each wet mass.
    expect(shown).toContain("Source biochar wet mass (kg) 250 kg 200 kg dry biochar");
    expect(shown).toContain("Chicken manure wet mass (kg) 100 kg 80 kg dry solids");
    // Goods move on deliveries, so transport reads there, not on the product.
    expect(shown).not.toMatch(/transport/i);
    for (const hidden of ["% of total", "Show calculation", "is the sum of its parts"]) {
      expect(shown).not.toContain(hidden);
    }

    fireEvent.click(screen.getByRole("button", { name: "About Product composition" }));
    const panel = text(await screen.findByRole("dialog"));
    expect(panel).toContain("% of total");
    expect(panel).toContain("Wet biochar product is the sum of its parts: 200 kg + 80 kg + 70 kg + 50 kg = 400 kg.");
    expect(panel).toContain("source allocation saved with the product");
    expect(panel).toContain("snapshot saved with the product");
  });

  it("shows masses at save precision and omits the bar when a saved part is missing", () => {
    const precise = { ...product, waterAddedKg: 50.125, composition: { ingredients: [{ ...(product.composition as { ingredients: Record<string, unknown>[] }).ingredients[0], massDryKg: null }] } } as unknown as BiocharProductWithRelations;
    const { container } = render(<EntitySideSheetSections sections={productSheetSections(precise, "UTC")} />);
    const shown = text(container);
    expect(shown).toContain("50.125 kg");
    expect(shown).toContain("Chicken manure solids");
    expect(shown).not.toContain("Not available");
    // The key reads at save precision too, not only the saved field.
    expect(shown).toContain("Water added 50.125 kg");
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });
});
