import { describe, expect, it } from "vitest";
import { formatStorageLocationType } from "./storage-locations";

describe("formatStorageLocationType", () => {
  it("uses sentence case for operator-facing bin types", () => {
    expect(formatStorageLocationType("feedstock_bin")).toBe("Feedstock bin");
    expect(formatStorageLocationType("biochar_bin")).toBe("Biochar bin");
    expect(formatStorageLocationType("product_bin")).toBe("Product bin");
  });
});
