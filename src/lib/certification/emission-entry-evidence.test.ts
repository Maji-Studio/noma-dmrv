import { expect, it } from "vitest";
import { entryNeedsFile, entryAmountIsZero } from "./emission-entry-evidence";
import { FILE_POLICIES } from "@/lib/isometric/template-observations/file-policies";

it("does not exempt empty or malformed monitored values", () => {
  expect(entryAmountIsZero([])).toBe(false);
  expect(entryAmountIsZero([{ inputKey: "energy", magnitude: "invalid" }])).toBe(false);
  expect(entryAmountIsZero([{ inputKey: "energy", magnitude: "0" }, { inputKey: "energy", magnitude: "invalid" }])).toBe(false);
});

it.each(FILE_POLICIES)("keeps Recorded zero exempt under %s", (policy) => {
  expect(entryNeedsFile(policy, { kind: "zero" })).toBe(false);
});

it.each([
  { keys: ["initial_readout", "final_readout"], values: ["120", "120.000"], zero: true },
  { keys: ["initial_readout", "final_readout"], values: ["0", "5"], zero: false },
  { keys: ["concentration", "mass_flow"], values: ["0", "3"], zero: true },
  { keys: ["concentration", "mass_flow"], values: ["3", "0"], zero: true },
  { keys: ["mass", "distance"], values: ["3", "0"], zero: true },
  { keys: ["time"], values: ["0.000"], zero: true },
  { keys: ["energy"], values: ["0.000"], zero: true },
  { keys: ["mass", "distance"], values: ["0", "invalid"], zero: false },
  { keys: ["initial_readout", "final_readout"], values: ["120", "120.00000000000000000001"], zero: false },
])("checks the exact amount for $keys and $values", ({ keys, values, zero }) => {
  expect(entryAmountIsZero(values.map((magnitude, index) => ({ inputKey: keys[index], magnitude })))).toBe(zero);
});
