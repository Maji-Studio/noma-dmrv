import { expect, it } from "vitest";
import { contentsRows } from "./sub-bin-card";

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
