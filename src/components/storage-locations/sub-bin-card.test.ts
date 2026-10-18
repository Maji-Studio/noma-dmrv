import { expect, it } from "vitest";
import { contentsRows } from "./sub-bin-card";

it("lists a sub-bin's contents as dry biochar, each ingredient's solids and estimated water", () => {
  expect(contentsRows({ dryMassKg: 90, ingredients: [{ name: "Compost", solidsKg: 70 }], waterKg: 40 })).toEqual([
    { label: "Dry biochar", value: "90 kg" }, { label: "Compost solids", value: "70 kg" }, { label: "Water, estimated", value: "40 kg" },
  ]);
  // Pure biochar has no ingredient row; no wet estimate means no water row.
  expect(contentsRows({ dryMassKg: 270, ingredients: [], waterKg: null })).toEqual([{ label: "Dry biochar", value: "270 kg" }]);
});
