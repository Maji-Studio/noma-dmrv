import { expect, it } from "vitest";
import { stockPointRows } from "./stock-level-chart";
import { estimateKg } from "./output-stock-history-days";

it("reads the chart tooltip's estimated water and wet mass in whole kg, and the solids with their decimal", () => {
  expect(stockPointRows({ t: 0, dryKg: 69.7, waterKg: 5.3, wetKg: 75 }, "Dry biochar", estimateKg)).toEqual([
    { label: "Dry biochar", value: "69.7 kg" }, { label: "Water, estimated", value: "5 kg" }, { label: "Wet, estimated", value: "75 kg" },
  ]);
  expect(stockPointRows({ t: 0, dryKg: 10.4, waterKg: 2.6, wetKg: 13.4, ingredientsKg: 0.4 }, "Dry biochar", estimateKg).map((row) => row.value))
    .toEqual(["10.4 kg", "0.4 kg", "3 kg", "13 kg"]);
});

it("leaves out water without an honest figure", () => {
  expect(stockPointRows({ t: 0, dryKg: 9, waterKg: null, wetKg: null }, "Dry biochar", estimateKg).map((row) => row.label)).toEqual(["Dry biochar", "Wet, estimated"]);
});

it("keeps one decimal by default, as a feedstock bin's weighed wet mass reads (no whole-kg rounding)", () => {
  expect(stockPointRows({ t: 0, dryKg: 69.7, waterKg: 5.3, wetKg: 75.4 }, "Dry solids, estimated")).toEqual([
    { label: "Dry solids, estimated", value: "69.7 kg" }, { label: "Water, estimated", value: "5.3 kg" }, { label: "Wet, estimated", value: "75.4 kg" },
  ]);
});
