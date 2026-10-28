import { expect, it } from "vitest";
import { outputEntryMass } from "./output-entry-mass";
import type { OutputSubBin } from "@/types/output-stock";
import { bayFigure, legendMass } from "./sub-bin-bays";
import { subBinContentsRows, movementMass, subBinMoistureCaption, subBinWetText } from "./sub-bin-card";

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

const rows = (values: Pick<OutputSubBin, "dryMassKg" | "solidsKg" | "ingredients" | "wetEstimateKg">) => subBinContentsRows({ ...subBin(null), ...values });

it("lists a sub-bin's contents top down as the bay draws them: water, each ingredient's solids, dry biochar", () => {
  expect(rows({ dryMassKg: 90, solidsKg: 160, ingredients: [{ name: "Compost", solidsKg: 70 }], wetEstimateKg: 200 })).toEqual([
    { label: "Water, estimated", value: "40 kg" }, { label: "Compost solids", value: "70 kg" }, { label: "Dry biochar", value: "90 kg" },
  ]);
  // Pure biochar has no ingredient row; no wet estimate means no water row.
  expect(rows({ dryMassKg: 270, solidsKg: 270, ingredients: [], wetEstimateKg: null })).toEqual([{ label: "Dry biochar", value: "270 kg" }]);
});

it("keeps the unnamed ingredient solids as one row, so the contents still add up", () => {
  expect(rows({ dryMassKg: 90, solidsKg: 150, ingredients: [], wetEstimateKg: 190 })).toEqual([
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

it("pins a split product bay's tooltip rows: water 40, compost solids 70, dry biochar 90", () => {
  const bay: OutputSubBin = { ...subBin(200), dryMassKg: 90, solidsKg: 160, ingredients: [{ name: "Compost", solidsKg: 70 }] };
  expect(subBinContentsRows(bay)).toEqual([
    { label: "Water, estimated", value: "40 kg" }, { label: "Compost solids", value: "70 kg" }, { label: "Dry biochar", value: "90 kg" },
  ]);
  expect(subBinContentsRows({ ...bay, wetEstimateKg: null })).toEqual([
    { label: "Compost solids", value: "70 kg" }, { label: "Dry biochar", value: "90 kg" },
  ]);
});

it("rounds the estimated water like the wet figure, and leaves dry biochar and ingredient solids at their decimal", () => {
  // 75 kg wet over 69.7 kg dry biochar: the water is 5.3 kg, read as "5 kg" under "75 kg" (#1382).
  const bay: OutputSubBin = { ...subBin(75), dryMassKg: 69.7, solidsKg: 69.7 };
  expect(subBinContentsRows(bay)).toEqual([
    { label: "Water, estimated", value: "5 kg" }, { label: "Dry biochar", value: "69.7 kg" },
  ]);
  const withIngredient: OutputSubBin = { ...bay, solidsKg: 72.2, ingredients: [{ name: "Compost", solidsKg: 2.5 }] };
  expect(subBinContentsRows(withIngredient)).toEqual([
    { label: "Water, estimated", value: "3 kg" }, { label: "Compost solids", value: "2.5 kg" }, { label: "Dry biochar", value: "69.7 kg" },
  ]);
});

it("reads estimated water in whole kg in the bay legend and the other parts with their decimal", () => {
  expect(legendMass(663.1, true)).toBe("663 kg");
  expect(legendMass(298.1, false)).toBe("298.1 kg");
});
