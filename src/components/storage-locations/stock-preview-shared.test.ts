import { describe, expect, it } from "vitest";
import { facilityStockFigure } from "./stock-preview-shared";

describe("facilityStockFigure", () => {
  it.each([
    { wetKg: 800, dryKg: 640, figure: "800 kg wet mass" },
    { wetKg: 2500, dryKg: 2000, figure: "2.5 t wet mass" },
    { wetKg: null, dryKg: 640, figure: "640 kg dry biochar" },
    { wetKg: null, dryKg: 1200, figure: "1.2 t dry biochar" },
    { wetKg: 0, dryKg: 50, figure: "0 kg wet mass" },
    { wetKg: null, dryKg: 0, figure: "0 kg dry biochar" },
  ])("formats $wetKg wet and $dryKg dry as $figure", ({ wetKg, dryKg, figure }) => {
    expect(facilityStockFigure(wetKg, dryKg)).toBe(figure);
  });
});
