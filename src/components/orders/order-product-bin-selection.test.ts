import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const orderFormSource = readFileSync(
  new URL("./order-form.tsx", import.meta.url),
  "utf8",
);
const biocharProductOptionsSource = readFileSync(
  new URL("../../data-access/entities/biochar-products.ts", import.meta.url),
  "utf8",
);

describe("order product-bin selection", () => {
  it("asks the operator to select the product bin while retaining the product-batch field", () => {
    expect(orderFormSource).toContain('name="biocharProductId"');
    expect(orderFormSource).toContain('label="Product bin"');
    expect(orderFormSource).toContain('placeholder="Select product bin..."');
    expect(orderFormSource).not.toContain('label="Biochar product"');
  });

  it("projects biochar-product options using their product-bin identity", () => {
    expect(biocharProductOptionsSource).toContain(
      "name: storageLocations.name",
    );
    expect(biocharProductOptionsSource).toContain(
      "eq(biocharProducts.storageLocationId, storageLocations.id)",
    );
  });

  it("wires tracked product composition into a preview after quantity and before packaging", () => {
    const selectorIndex = orderFormSource.indexOf(
      'name="biocharProductId"',
    );
    const quantityIndex = orderFormSource.indexOf('id="quantityKg"');
    const previewIndex = orderFormSource.indexOf("<OrderMassPreview");
    const packagingIndex = orderFormSource.indexOf('id="packaging"');
    const valueIndex = orderFormSource.indexOf('id="value"');
    const currencyIndex = orderFormSource.indexOf('id="currency"');

    expect(orderFormSource).toContain('name: "biocharProductId"');
    expect(orderFormSource).toContain('name: "quantityKg"');
    expect(orderFormSource).toContain(
      "productWetBasisKg={selectedBiocharProduct?.remainingMass?.wetKg ?? null}",
    );
    expect(orderFormSource).toContain(
      "productDryBiocharKg={selectedBiocharProduct?.remainingMass?.dryKg ?? null}",
    );
    expect(selectorIndex).toBeLessThan(quantityIndex);
    expect(quantityIndex).toBeLessThan(previewIndex);
    expect(previewIndex).toBeLessThan(packagingIndex);
    expect(packagingIndex).toBeLessThan(valueIndex);
    expect(valueIndex).toBeLessThan(currencyIndex);
  });

  it("shows current product availability as a non-blocking quantity warning", () => {
    expect(orderFormSource).toContain("orderAvailabilityWarning(");
    expect(orderFormSource).toContain(
      "selectedBiocharProduct?.remainingMass?.wetKg",
    );
    expect(orderFormSource).toContain("warning={availabilityWarning}");
  });

  it("passes the edited order id to product list and detail availability", () => {
    expect(orderFormSource).toContain(
      "const productFilterBy = order ? { excludeOrderId: order.id } : undefined;",
    );
    expect(orderFormSource).toContain(
      'useEntityById(\n    "biocharProduct",\n    watchedBiocharProductId || undefined,\n    productFilterBy,\n  )',
    );
    expect(orderFormSource).toMatch(
      /<FormEntitySelect[\s\S]*?entityType="biocharProduct"[\s\S]*?filterBy=\{[\s\S]*?\.\.\.productFilterBy,[\s\S]*?\}/,
    );
  });
});
