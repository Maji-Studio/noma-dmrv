import { expect, it } from "vitest";
import { entryNeedsFile, entryValuesAreZero } from "./emission-entry-evidence";
import { FILE_POLICIES } from "@/lib/isometric/template-observations/file-policies";

it("does not exempt empty or malformed monitored values", () => {
  expect(entryValuesAreZero([])).toBe(false);
  expect(entryValuesAreZero([{ magnitude: "invalid" }])).toBe(false);
  expect(entryValuesAreZero([{ magnitude: "0" }, { magnitude: "invalid" }])).toBe(false);
});

it.each(FILE_POLICIES)("keeps Recorded zero exempt under %s", (policy) => {
  expect(entryNeedsFile(policy, { kind: "zero" })).toBe(false);
});
