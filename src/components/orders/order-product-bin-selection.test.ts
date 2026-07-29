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

  it("wires the selected product moisture into a preview after quantity and before packaging", () => {
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
      "selectedBiocharProduct?.mass?.moisturePercent",
    );
    expect(selectorIndex).toBeLessThan(quantityIndex);
    expect(quantityIndex).toBeLessThan(previewIndex);
    expect(previewIndex).toBeLessThan(packagingIndex);
    expect(packagingIndex).toBeLessThan(valueIndex);
    expect(valueIndex).toBeLessThan(currencyIndex);
  });
});
