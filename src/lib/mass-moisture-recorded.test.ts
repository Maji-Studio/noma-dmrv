import { expect, it, vi } from "vitest";

// Reword the placeholder: the predicate must not care what the copy says.
vi.mock("@/lib/copy-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copy-utils")>();
  return {
    ...actual,
    MISSING_VALUE: { ...actual.MISSING_VALUE, notRecorded: "Reworded placeholder" },
  };
});

import { formatRecordedMass, isRecordedMass } from "./mass-moisture";

it("classifies a mass without reading the placeholder wording", () => {
  expect(formatRecordedMass(null)).toBe("Reworded placeholder");
  expect(isRecordedMass(null)).toBe(false);
  expect(isRecordedMass(undefined)).toBe(false);
  expect(isRecordedMass(Number.NaN)).toBe(false);
  expect(isRecordedMass(Number.POSITIVE_INFINITY)).toBe(false);
  expect(isRecordedMass(-1)).toBe(false);
  expect(isRecordedMass(0)).toBe(true);
  expect(isRecordedMass(12.5)).toBe(true);
});
