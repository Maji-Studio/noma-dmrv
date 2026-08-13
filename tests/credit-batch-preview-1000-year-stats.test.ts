/**
 * Current sampled 1,000-year CO₂e-stored explanatory preview.
 */
import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_1000_YEAR_REPLICATES_INPUT,
  CO2_C_MOLAR_RATIO,
  computeApplicationCo2eStoredBlueprint1000,
  computeBlueprint1000YearDurability,
  type Blueprint1000YearReplicate,
} from "@/lib/calculations/biochar-removal";
import {
  build1000YearSequestrationSample,
  TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
  S_FRACTION_MEASUREMENT_PROPERTY,
} from "@/lib/isometric/transformers/measurement-sample";

const REPLICATES: Blueprint1000YearReplicate[] = [
  { totalCarbonPercent: 80, inorganicCarbonPercent: 1, sReflectanceFraction: 0.91 },
  { totalCarbonPercent: 82, inorganicCarbonPercent: 1.1, sReflectanceFraction: 0.92 },
  { totalCarbonPercent: 84, inorganicCarbonPercent: 1.2, sReflectanceFraction: 0.93 },
];
const DRY_MASS_TONNES = 12.5;

/** The current component reduction, recomputed from its four-input payload. */
function currentPreviewFigureFromPayload(dryMassTonnes: number): number {
  const bodies = REPLICATES.map((r, index) =>
    build1000YearSequestrationSample({
      replicate: {
        totalCarbonContentFraction: r.totalCarbonPercent / 100,
        inorganicCarbonContentFraction: r.inorganicCarbonPercent / 100,
        sFraction: r.sReflectanceFraction,
      },
      projectId: "prj_X",
      supplierRefId: `nm-mts-test-pb-cb-s${index + 1}-v1`,
      measuredAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    }),
  );

  const magnitudesOf = (qualifier: string | null) =>
    bodies.flatMap((body) => body.values)
      .filter((v) => v.measurement_property.qualifier === qualifier)
      .map((v) => v.value.magnitude);
  const carbons = magnitudesOf(
    TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY.qualifier,
  );
  const inorganicCarbons = magnitudesOf("total_inorganic_carbon");
  const sFractions = magnitudesOf(S_FRACTION_MEASUREMENT_PROPERTY.qualifier);
  expect(carbons).toHaveLength(REPLICATES.length);
  expect(inorganicCarbons).toHaveLength(REPLICATES.length);
  expect(sFractions).toHaveLength(REPLICATES.length);

  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  const meanOrganicCarbon = mean(
    carbons.map((total, index) => total - inorganicCarbons[index]),
  );
  const meanS = mean(sFractions);
  const n = sFractions.length;
  const rawDurability = meanS - Math.sqrt((meanS * (1 - meanS)) / n);
  const cappedDurability = Math.min(rawDurability, 0.95);
  return (
    dryMassTonnes *
    meanOrganicCarbon *
    cappedDurability *
    CO2_C_MOLAR_RATIO
  );
}

describe("computeBlueprint1000YearDurability", () => {
  it("subtracts measured inorganic carbon within each replicate before averaging", () => {
    const durability = computeBlueprint1000YearDurability(REPLICATES);
    expect(durability).not.toBeNull();
    const meanS = (0.91 + 0.92 + 0.93) / 3;
    expect(durability!.meanOrganicCarbonFraction).toBeCloseTo(
      ((80 - 1) + (82 - 1.1) + (84 - 1.2)) / 3 / 100,
      12,
    );
    expect(durability!.rawDurability).toBeCloseTo(
      meanS - Math.sqrt((meanS * (1 - meanS)) / 3),
      12,
    );
    expect(durability!.cappedDurability).toBe(
      durability!.rawDurability,
    );
    expect(durability!.capApplied).toBe(false);
    expect(durability!.replicateCount).toBe(3);
  });

  it("preserves total carbon when measured inorganic carbon is zero", () => {
    const durability = computeBlueprint1000YearDurability(
      REPLICATES.map((replicate) => ({
        ...replicate,
        inorganicCarbonPercent: 0,
      })),
    );
    expect(durability?.meanOrganicCarbonFraction).toBeCloseTo(0.82, 12);
  });

  it("does not credit negative organic carbon within the reconciliation tolerance", () => {
    const durability = computeBlueprint1000YearDurability(
      REPLICATES.map((replicate) => ({
        ...replicate,
        totalCarbonPercent: 1,
        inorganicCarbonPercent: 1.25,
      })),
    );
    expect(durability?.meanOrganicCarbonFraction).toBe(0);
  });

  it("floors the aggregate mean rather than each registry replicate", () => {
    const durability = computeBlueprint1000YearDurability([
      { ...REPLICATES[0], totalCarbonPercent: 1, inorganicCarbonPercent: 1.25 },
      { ...REPLICATES[1], totalCarbonPercent: 1, inorganicCarbonPercent: 1.25 },
      { ...REPLICATES[2], totalCarbonPercent: 2, inorganicCarbonPercent: 1 },
    ]);
    expect(durability?.meanOrganicCarbonFraction).toBeCloseTo(
      ((-0.25 - 0.25 + 1) / 3) / 100,
      12,
    );
  });

  it("caps a raw durability above 0.95", () => {
    const durability = computeBlueprint1000YearDurability(
      REPLICATES.map((replicate) => ({
        ...replicate,
        sReflectanceFraction: 1,
      })),
    );
    expect(durability).toMatchObject({
      rawDurability: 1,
      cappedDurability: 0.95,
      capApplied: true,
    });
  });

  it("floors a negative binomial lower estimate at zero", () => {
    const durability = computeBlueprint1000YearDurability(
      REPLICATES.map((replicate) => ({
        ...replicate,
        sReflectanceFraction: 0.1,
      })),
    );
    expect(durability?.rawDurability).toBeLessThan(0);
    expect(durability?.cappedDurability).toBe(0);
    expect(durability?.capApplied).toBe(false);
  });

  it("returns null on empty or non-finite input", () => {
    expect(computeBlueprint1000YearDurability([])).toBeNull();
    expect(
      computeBlueprint1000YearDurability([
        { ...REPLICATES[0], inorganicCarbonPercent: Number.NaN },
      ]),
    ).toBeNull();
  });

  it.each([-0.01, 1.01])(
    "returns null for an R₀ fraction outside the unit interval (%s)",
    (sReflectanceFraction) => {
      expect(
        computeBlueprint1000YearDurability([
          { ...REPLICATES[0], sReflectanceFraction },
        ]),
      ).toBeNull();
    },
  );
});

describe("computeApplicationCo2eStoredBlueprint1000", () => {
  it("matches the figure implied by the submitted measurement-sample payload", () => {
    const preview = computeApplicationCo2eStoredBlueprint1000({
      dryMassTonnes: DRY_MASS_TONNES,
      replicates: REPLICATES,
    });

    expect(preview.co2eStoredTonnes).not.toBeNull();
    expect(preview.co2eStoredTonnes).toBeCloseTo(
      currentPreviewFigureFromPayload(DRY_MASS_TONNES),
      10,
    );
    expect(preview.missingInputs).toEqual([]);
    expect(preview.organicCarbonPercent).toBeCloseTo(80.9, 12);
    expect(preview.rawFDurable).toBeCloseTo(preview.fDurable!, 12);
    expect(preview.durabilityCapped).toBe(false);
    expect(preview.effectiveSoilTemperatureC).toBeNull();
  });

  it("uses the capped durability in stored CO2e", () => {
    const cappedReplicates = REPLICATES.map((replicate) => ({
      ...replicate,
      sReflectanceFraction: 1,
    }));
    const preview = computeApplicationCo2eStoredBlueprint1000({
      dryMassTonnes: DRY_MASS_TONNES,
      replicates: cappedReplicates,
    });
    const meanOrganicPercent = ((79 + 80.9 + 82.8) / 3);
    expect(preview.rawFDurable).toBe(1);
    expect(preview.fDurable).toBe(0.95);
    expect(preview.durabilityCapped).toBe(true);
    expect(preview.co2eStoredTonnes).toBeCloseTo(
      DRY_MASS_TONNES *
        (meanOrganicPercent / 100) *
        0.95 *
        CO2_C_MOLAR_RATIO,
      12,
    );
  });

  it("degrades to the null gap contract below the replicate minimum — never Eq.6", () => {
    const preview = computeApplicationCo2eStoredBlueprint1000({
      dryMassTonnes: DRY_MASS_TONNES,
      replicates: REPLICATES.slice(0, 2),
    });

    expect(preview.co2eStoredTonnes).toBeNull();
    expect(preview.fDurable).toBeNull();
    expect(preview.missingInputs).toEqual([
      BLUEPRINT_1000_YEAR_REPLICATES_INPUT,
    ]);
  });

  it("reports a missing dry mass alongside the durability inputs", () => {
    const preview = computeApplicationCo2eStoredBlueprint1000({
      dryMassTonnes: null,
      replicates: REPLICATES,
    });

    expect(preview.co2eStoredTonnes).toBeNull();
    expect(preview.missingInputs).toEqual(["dryMassTonnes"]);
  });
});
