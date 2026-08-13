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
  extract1000YearBlueprintReplicates,
  independentPreviewMissingInputs,
} from "@/data-access/credit-batch-accounting";
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
  const body = build1000YearSequestrationSample({
    replicates: REPLICATES.map((r) => ({
      totalCarbonContentFraction: r.totalCarbonPercent / 100,
      inorganicCarbonContentFraction: r.inorganicCarbonPercent / 100,
      sFraction: r.sReflectanceFraction,
    })),
    productMassKg: dryMassTonnes * 1000,
    projectId: "prj_X",
    supplierRefId: "nm-mts-test-pb-cb-v1",
    measuredAt: "2026-01-31T00:00:00.000Z",
  });
  expect(body).not.toBeNull();

  const magnitudesOf = (qualifier: string | null) =>
    body!.values
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

  it("returns null on empty or non-finite input", () => {
    expect(computeBlueprint1000YearDurability([])).toBeNull();
    expect(
      computeBlueprint1000YearDurability([
        { ...REPLICATES[0], inorganicCarbonPercent: Number.NaN },
      ]),
    ).toBeNull();
  });
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

describe("extract1000YearBlueprintReplicates", () => {
  it("keeps only samples with total, measured inorganic, and s_fraction", () => {
    expect(
      extract1000YearBlueprintReplicates([
        { totalCarbonPercent: 80, inorganicCarbonPercent: 1, sReflectanceFraction: 0.91 },
        { totalCarbonPercent: null, inorganicCarbonPercent: 1, sReflectanceFraction: 0.92 },
        { totalCarbonPercent: 84, inorganicCarbonPercent: null, sReflectanceFraction: 0.93 },
        { totalCarbonPercent: 84, inorganicCarbonPercent: 1, sReflectanceFraction: null },
      ]),
    ).toEqual([{ totalCarbonPercent: 80, inorganicCarbonPercent: 1, sReflectanceFraction: 0.91 }]);
  });
});

describe("independentPreviewMissingInputs", () => {
  it("reports sampled 1000-year chemistry even with no application calculation", () => {
    expect(
      independentPreviewMissingInputs(
        { durabilityOption: "1000_year", sampling: "sampled" },
        [
          { totalCarbonPercent: 80, inorganicCarbonPercent: 1, sReflectanceFraction: 0.91 },
          { totalCarbonPercent: null, inorganicCarbonPercent: 1, sReflectanceFraction: 0.92 },
        ],
      ),
    ).toEqual([BLUEPRINT_1000_YEAR_REPLICATES_INPUT]);
  });

  it("blocks when one of four selected Samples lacks measured inorganic carbon", () => {
    expect(
      independentPreviewMissingInputs(
        { durabilityOption: "1000_year", sampling: "sampled" },
        [
          ...REPLICATES,
          {
            totalCarbonPercent: 85,
            inorganicCarbonPercent: null,
            sReflectanceFraction: 0.94,
          },
        ],
      ),
    ).toEqual([BLUEPRINT_1000_YEAR_REPLICATES_INPUT]);
  });

  it("preserves Method-B and 200-year behavior", () => {
    expect(
      independentPreviewMissingInputs(
        { durabilityOption: "1000_year", sampling: "unsampled" },
        [],
      ),
    ).toEqual([]);
    expect(
      independentPreviewMissingInputs(
        { durabilityOption: "200_year", sampling: "sampled" },
        [],
      ),
    ).toEqual([]);
  });
});
