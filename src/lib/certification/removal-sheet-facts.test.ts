import { describe, expect, it } from "vitest";
import { projectRemovalSheetFacts } from "./removal-sheet-facts";

const batch = (code: string, over = {}) => ({
  id: `id-${code}`, code, durabilityOption: "1000_year" as const, sampling: "sampled", appliedDryTons: 2, co2eStoredTonnes: 5, ...over,
});

describe("projectRemovalSheetFacts", () => {
  it("sums dry mass and estimate and sorts batches by code", () => {
    const facts = projectRemovalSheetFacts([batch("CB-2"), batch("CB-1")], "Plant");
    expect(facts.batches.map((b) => b.code)).toEqual(["CB-1", "CB-2"]);
    expect(facts).toMatchObject({ dryTonnes: 4, co2eEstimateTonnes: 10, facilityName: "Plant", samplingLabel: "Sampled", durabilityLabel: "1000-year (R₀ reflectance)" });
  });

  it("gives no estimate unless every batch has one", () => {
    expect(projectRemovalSheetFacts([batch("A"), batch("B", { co2eStoredTonnes: null })], null).co2eEstimateTonnes).toBeNull();
    expect(projectRemovalSheetFacts([], null)).toMatchObject({ co2eEstimateTonnes: null, durabilityLabel: null });
  });

  it("gives no dry mass when a batch lacks one or there are no batches", () => {
    expect(projectRemovalSheetFacts([batch("A"), batch("B", { appliedDryTons: null })], null).dryTonnes).toBeNull();
    expect(projectRemovalSheetFacts([], null).dryTonnes).toBeNull();
    expect(projectRemovalSheetFacts([batch("A", { appliedDryTons: 0 })], null).dryTonnes).toBe(0);
  });

  it("lists both labels when batches differ", () => {
    const facts = projectRemovalSheetFacts([batch("A"), batch("B", { durabilityOption: "200_year", sampling: "unsampled" })], null);
    expect(facts.durabilityLabel).toBe("1000-year (R₀ reflectance), 200-year (H:Corg)");
    expect(facts.samplingLabel).toBe("Sampled, Not sampled");
  });
});
