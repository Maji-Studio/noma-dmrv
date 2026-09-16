import { describe, expect, it } from "vitest";
import { selectForestryEntry } from "./forestry-catalogue";

const FORESTRY_WASTE = { id: "forestry-waste", name: "Forestry waste" };
const FOREST_RESIDUE = { id: "forest-residue", name: "Forest residues" };

describe("forestry catalogue selection", () => {
  it("prefers the requested name even when several catalogue entries match", () => {
    expect(selectForestryEntry([FOREST_RESIDUE, FORESTRY_WASTE])).toBe(FORESTRY_WASTE);
  });

  it("accepts a forest residue equivalent", () => {
    expect(selectForestryEntry([FOREST_RESIDUE])).toBe(FOREST_RESIDUE);
  });

  it("fails instead of silently choosing an unrelated material", () => {
    expect(() => selectForestryEntry([{ id: "rice", name: "Rice husks" }])).toThrow(
      "no forestry waste or forest residue entry found",
    );
  });
});
