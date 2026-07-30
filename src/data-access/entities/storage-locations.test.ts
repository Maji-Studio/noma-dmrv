import { describe, expect, it } from "vitest";
import { formatStorageLocationSubtitle } from "./storage-locations";

describe("formatStorageLocationSubtitle", () => {
  it("labels available biochar with explicit wet and dry figures", () => {
    expect(
      formatStorageLocationSubtitle(
        "biochar_bin",
        null,
        null,
        0,
        0,
        0,
        3_500,
        3_430,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        null,
      ),
    ).toBe(
      "Biochar bin · Wet biochar: 3,500kg | Dry biochar: 3,430kg available",
    );
  });

  it("labels product-bin inventory with explicit wet and dry figures", () => {
    expect(
      formatStorageLocationSubtitle(
        "product_bin",
        null,
        null,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        3_500,
        3_325,
        0,
        3_500,
        null,
      ),
    ).toBe(
      "Product bin · Pure biochar · Wet biochar product: 3,500kg | Dry biochar: 3,325kg stored · 3,500 kg biochar equivalent",
    );
  });
});
