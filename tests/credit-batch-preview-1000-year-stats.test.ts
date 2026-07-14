/**
 * 1000-year CO₂e-stored preview — Certify-blueprint parity.
 *
 * The preview for a 1000-year batch must compute from the SAME inputs and the
 * SAME reduction the registry's `biochar_sequestration_1000_year` blueprint
 * runs over the submitted measurement sample (NOT module Eq.6 over the legacy
 * batch petrography columns — issue #375). The core test here derives the
 * expected figure independently from `build1000YearSequestrationSample`'s
 * payload and asserts the preview math yields the identical number.
 */
import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_1000_YEAR_REPLICATES_INPUT,
  CO2_C_MOLAR_RATIO,
  computeApplicationCo2eStoredBlueprint1000,
  computeBlueprint1000YearDurability,
  type Blueprint1000YearReplicate,
} from "@/lib/calculations/biochar-removal";
import { extract1000YearBlueprintReplicates } from "@/data-access/credit-batch-previews";
import {
  build1000YearSequestrationSample,
  CARBON_CONTENTS_MEASUREMENT_PROPERTY,
  S_FRACTION_MEASUREMENT_PROPERTY,
} from "@/lib/isometric/transformers/measurement-sample";

const REPLICATES: Blueprint1000YearReplicate[] = [
  { totalCarbonPercent: 80, sReflectanceFraction: 0.91 },
  { totalCarbonPercent: 82, sReflectanceFraction: 0.92 },
  { totalCarbonPercent: 84, sReflectanceFraction: 0.93 },
];
const DRY_MASS_TONNES = 12.5;

/** The registry-side reduction, recomputed from a submission payload. */
function registryFigureFromPayload(dryMassTonnes: number): number {
  const body = build1000YearSequestrationSample({
    replicates: REPLICATES.map((r) => ({
      carbonContentFraction: r.totalCarbonPercent / 100,
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
  const carbons = magnitudesOf(CARBON_CONTENTS_MEASUREMENT_PROPERTY.qualifier);
  const sFractions = magnitudesOf(S_FRACTION_MEASUREMENT_PROPERTY.qualifier);
  expect(carbons).toHaveLength(REPLICATES.length);
  expect(sFractions).toHaveLength(REPLICATES.length);

  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  const meanCarbon = mean(carbons);
  const meanS = mean(sFractions);
  const n = sFractions.length;
  // `durable_fraction = mean(s_fraction) − √(mean·(1−mean)/n)`, then
  // product_mass × mean(carbon_contents) × durable_fraction × 44.01/12.01
  // (in tonnes here; the registry's kg payload scales linearly).
  const durableFraction = meanS - Math.sqrt((meanS * (1 - meanS)) / n);
  return dryMassTonnes * meanCarbon * durableFraction * CO2_C_MOLAR_RATIO;
}

describe("computeBlueprint1000YearDurability", () => {
  it("reduces replicates exactly as the registry blueprint does", () => {
    const durability = computeBlueprint1000YearDurability(REPLICATES);
    expect(durability).not.toBeNull();
    const meanS = (0.91 + 0.92 + 0.93) / 3;
    expect(durability!.meanCarbonContentFraction).toBeCloseTo(0.82, 12);
    expect(durability!.durableFraction).toBeCloseTo(
      meanS - Math.sqrt((meanS * (1 - meanS)) / 3),
      12,
    );
    expect(durability!.replicateCount).toBe(3);
  });

  it("returns null on empty input", () => {
    expect(computeBlueprint1000YearDurability([])).toBeNull();
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
      registryFigureFromPayload(DRY_MASS_TONNES),
      10,
    );
    expect(preview.missingInputs).toEqual([]);
    // Blueprint semantics: no 0.95 cap, no soil-temperature term.
    expect(preview.durabilityCapped).toBe(false);
    expect(preview.effectiveSoilTemperatureC).toBeNull();
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
  it("keeps only samples with BOTH total carbon and s_fraction — the submission filter", () => {
    expect(
      extract1000YearBlueprintReplicates([
        { totalCarbonPercent: 80, sReflectanceFraction: 0.91 },
        { totalCarbonPercent: null, sReflectanceFraction: 0.92 },
        { totalCarbonPercent: 84, sReflectanceFraction: null },
      ]),
    ).toEqual([{ totalCarbonPercent: 80, sReflectanceFraction: 0.91 }]);
  });
});
