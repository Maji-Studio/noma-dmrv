import { describe, expect, it } from "vitest";
import { deriveAppliedDryTons } from "./applied-dry-tons";

const FIRST_SLICE_DRY_TONS = 1.25;
const SECOND_SLICE_DRY_TONS = 2.5;

describe("deriveAppliedDryTons", () => {
  it("sums all known application slices' dry mass in tonnes", () => {
    expect(deriveAppliedDryTons([
      { biocharAppliedDryTons: FIRST_SLICE_DRY_TONS },
      { biocharAppliedDryTons: SECOND_SLICE_DRY_TONS },
    ])).toBe(FIRST_SLICE_DRY_TONS + SECOND_SLICE_DRY_TONS);
  });

  it("returns null instead of a partial sum when any slice has unknown dry mass", () => {
    expect(deriveAppliedDryTons([
      { biocharAppliedDryTons: FIRST_SLICE_DRY_TONS },
      { biocharAppliedDryTons: null },
      { biocharAppliedDryTons: SECOND_SLICE_DRY_TONS },
    ])).toBeNull();
  });

  it("returns null when there are no applications", () => {
    expect(deriveAppliedDryTons([])).toBeNull();
  });

  it("preserves known zero dry mass", () => {
    expect(deriveAppliedDryTons([{ biocharAppliedDryTons: 0 }])).toBe(0);
  });
});
