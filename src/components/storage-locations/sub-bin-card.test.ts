import { expect, it } from "vitest";
import { outputEntryMass } from "./output-entry-mass";
import type { OutputSubBin } from "@/types/output-stock";
import { bayFigure } from "./sub-bin-bays";
import { contentsRows, movementMass, subBinMoistureCaption, subBinWetText } from "./sub-bin-card";

const subBin = (wetEstimateKg: number | null): OutputSubBin => ({
  layerId: "l1", code: "R-1", placedAt: "2026-09-10T12:00:00.000Z", dryMassKg: 900, solidsKg: 900, wetEstimateKg,
  moisturePercent: null, basis: null, recentMovements: [], ingredients: [],
});

it("shows a sub-bin without a wet figure as its known dry biochar, never a placeholder", () => {
  expect(subBinWetText(subBin(null))).toBe("900 kg dry biochar");
  expect(subBinWetText(subBin(1000))).toBe("1,000 kg wet mass");
  expect(bayFigure(subBin(null))).toBe("900 kg dry biochar");
  expect(bayFigure(subBin(1000))).toBe("1,000");
  // A fractional dry mass reads the same on the bay and in the order row.
  const small = { ...subBin(null), dryMassKg: 0.4, solidsKg: 0.4 };
  expect(bayFigure(small)).toBe(subBinWetText(small));
  expect(bayFigure(small)).toBe("0.4 kg dry biochar");
});

it("lists a sub-bin's contents top down as the bay draws them: water, each ingredient's solids, dry biochar", () => {
  expect(contentsRows({ dryMassKg: 90, solidsKg: 160, ingredients: [{ name: "Compost", solidsKg: 70 }], waterKg: 40 })).toEqual([
    { label: "Water, estimated", value: "40 kg" }, { label: "Compost solids", value: "70 kg" }, { label: "Dry biochar", value: "90 kg" },
  ]);
  // Pure biochar has no ingredient row; no wet estimate means no water row.
  expect(contentsRows({ dryMassKg: 270, solidsKg: 270, ingredients: [], waterKg: null })).toEqual([{ label: "Dry biochar", value: "270 kg" }]);
});

it("keeps the unnamed ingredient solids as one row, so the contents still add up", () => {
  expect(contentsRows({ dryMassKg: 90, solidsKg: 150, ingredients: [], waterKg: 40 })).toEqual([
    { label: "Water, estimated", value: "40 kg" }, { label: "Ingredient solids", value: "60 kg" }, { label: "Dry biochar", value: "90 kg" },
  ]);
});

it("says when a sub-bin has no moisture reading, and names dry biochar in a movement", () => {
  expect(subBinMoistureCaption(subBin(null))).toBe("No moisture reading");
  expect(subBinMoistureCaption({ ...subBin(1000), moisturePercent: 26.7 })).toBe("26.7% moisture");
  expect(movementMass({ id: "m1", kind: "removed", occurredAt: "2026-09-10T12:00:00.000Z", wetMassKg: null, dryMassKg: -90 })).toBe("90 kg dry biochar");
});

it("names dry biochar the same way on a deleted entry's amount", () => {
  expect(outputEntryMass({ wetMassKg: null, dryMassKg: -90 })).toBe("90 kg dry biochar");
});
