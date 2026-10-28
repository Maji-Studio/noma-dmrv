import { expect, it } from "vitest";
import { lateEntryFigures } from "./late-entry-figures";

it("skips entries without input values", () => {
  expect(lateEntryFigures({ total: null, values: [] })).toBeNull();
});

it("uses the total for a single-value entry without adding values", () => {
  const total = { magnitude: "12", unit: "L" };
  expect(lateEntryFigures({ total, values: [{ magnitude: "12.00", unit: "L" }] }))
    .toStrictEqual({ value: total });
});

it("keeps every paired input as a plain figure when the total is null", () => {
  const values = [
    { inputKey: "mass", magnitude: "120", unit: "kg" },
    { inputKey: "distance", magnitude: "30", unit: "km" },
  ];
  expect(lateEntryFigures({ total: null, values })).toStrictEqual({
    value: { magnitude: "120", unit: "kg" },
    values: [{ magnitude: "120", unit: "kg" }, { magnitude: "30", unit: "km" }],
  });
});
