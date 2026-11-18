import { describe, expect, it } from "vitest";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { binSubtitle } from "./bins-card";

function bin(over: Record<string, unknown>): StorageLocationWithFacility {
  return {
    id: "b1",
    code: "FB-1",
    name: "Bin 1",
    type: "feedstock_bin",
    feedstockTypeName: null,
    formulationName: null,
    feedstockInventory: { feedstockTypes: [] },
    productInventory: { formulationNames: [] },
    ...over,
  } as unknown as StorageLocationWithFacility;
}

describe("binSubtitle", () => {
  it("names the bin kind and the feedstock type", () => {
    expect(binSubtitle(bin({ feedstockTypeName: "Forestry waste" }))).toBe("Feedstock bin · Forestry waste");
  });

  it("names the kind and the formulation of a product bin", () => {
    expect(binSubtitle(bin({ type: "product_bin", formulationName: "Compost mix" }))).toBe("Product bin · Compost mix");
  });

  it("drops what the bin holds when it repeats the bin's name", () => {
    expect(binSubtitle(bin({ name: "Forestry waste", feedstockTypeName: "Forestry waste" }))).toBe("Feedstock bin");
  });

  it("drops it when nothing is set", () => {
    expect(binSubtitle(bin({}))).toBe("Feedstock bin");
  });

  it("drops it when it repeats the kind", () => {
    expect(binSubtitle(bin({ type: "biochar_bin" }))).toBe("Biochar bin");
  });
});
