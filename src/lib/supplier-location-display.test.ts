import { describe, expect, it } from "vitest";
import {
  formatSupplierLocationDisplay,
  resolveSupplierLocationDisplay,
  resolveSupplierLocationText,
} from "./supplier-location-display";

const locations = [
  {
    name: "Secondary yard",
    city: "Kumasi",
    stateRegion: "Ashanti",
    country: "Ghana",
    isDefault: false,
  },
  {
    name: "Primary yard",
    city: "Accra",
    stateRegion: "Greater Accra",
    country: "Ghana",
    isDefault: true,
  },
];

describe("supplier location display", () => {
  it("keeps a non-empty legacy supplier location", () => {
    expect(resolveSupplierLocationDisplay("Legacy location", locations)).toBe(
      "Legacy location",
    );
  });

  it("falls back to the default structured location", () => {
    expect(resolveSupplierLocationDisplay("  ", locations)).toBe(
      "Primary yard, Accra, Greater Accra, Ghana",
    );
  });

  it("resolves the preformatted list-query fallback", () => {
    expect(resolveSupplierLocationText("", "Primary yard, Ghana")).toBe(
      "Primary yard, Ghana",
    );
  });

  it("falls back to the sole or first location when none is marked default", () => {
    expect(resolveSupplierLocationDisplay(null, [locations[0]])).toBe(
      "Secondary yard, Kumasi, Ashanti, Ghana",
    );
  });

  it("formats partial nested locations without empty separators", () => {
    expect(
      formatSupplierLocationDisplay({ country: "Ghana", stateRegion: null }),
    ).toBe("Ghana");
  });
});
