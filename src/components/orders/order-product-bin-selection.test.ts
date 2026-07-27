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
});
