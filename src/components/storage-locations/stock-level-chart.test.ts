import { expect, it } from "vitest";
import { stockPointRows } from "./stock-level-chart";

it("reads the chart tooltip's estimated water and wet mass in whole kg, and the solids with their decimal", () => {
  expect(stockPointRows({ t: 0, dryKg: 69.7, waterKg: 5.3, wetKg: 75 }, "Dry biochar")).toEqual([
    { label: "Dry biochar", value: "69.7 kg" }, { label: "Water, estimated", value: "5 kg" }, { label: "Wet, estimated", value: "75 kg" },
  ]);
  expect(stockPointRows({ t: 0, dryKg: 10.4, waterKg: 2.6, wetKg: 13.4, ingredientsKg: 0.4 }, "Dry biochar").map((row) => row.value))
    .toEqual(["10.4 kg", "0.4 kg", "3 kg", "13 kg"]);
});

it("leaves out water without an honest figure", () => {
  expect(stockPointRows({ t: 0, dryKg: 9, waterKg: null, wetKg: null }, "Dry biochar").map((row) => row.label)).toEqual(["Dry biochar", "Wet, estimated"]);
});
