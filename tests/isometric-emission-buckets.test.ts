/**
 * The §8.6.2 bucket weld (issue #349, ADR 0020).
 *
 * The bucket classification lives in TWO places that must agree:
 *   - `SOURCE_BUCKETS` in `utils/aggregation.ts` — drives which aggregated
 *     quantities the applied-mass attribution factor scales;
 *   - the `bucket` attribute on every `INPUT_MAPPING` entry in
 *     `transformers/datapoint.ts` — the submit-side classification per
 *     (group, blueprint, input) tuple.
 *
 * These tests weld the two so they cannot drift, and pin the expected bucket
 * per tuple as a literal table — a wrong reclassification (e.g. moving diesel
 * into the delivery bucket) MUST fail here.
 */
import { describe, expect, it } from "vitest";
import { INPUT_MAPPING } from "@/lib/isometric/transformers/datapoint";
import {
  isAppliedScopedSource,
  SOURCE_BUCKETS,
  type EmissionInputBucket,
} from "@/lib/isometric/utils/aggregation";

// Every (group, blueprint, input) → entry tuple in INPUT_MAPPING, flattened.
function allMappingEntries() {
  return Object.entries(INPUT_MAPPING).flatMap(([groupKey, blueprints]) =>
    Object.entries(blueprints).flatMap(([blueprintKey, inputs]) =>
      Object.entries(inputs).map(([inputKey, entry]) => ({
        groupKey,
        blueprintKey,
        inputKey,
        entry,
      })),
    ),
  );
}

describe("emission-input buckets — SOURCE_BUCKETS ⇄ INPUT_MAPPING weld (§8.6.2)", () => {
  it("covers every INPUT_MAPPING source field in SOURCE_BUCKETS", () => {
    for (const { groupKey, blueprintKey, inputKey, entry } of allMappingEntries()) {
      expect(
        entry.source in SOURCE_BUCKETS,
        `${groupKey}/${blueprintKey}/${inputKey} reads source "${String(entry.source)}" which has no SOURCE_BUCKETS classification`,
      ).toBe(true);
    }
  });

  it("assigns every INPUT_MAPPING entry a bucket whose applied-scoping agrees with SOURCE_BUCKETS", () => {
    for (const { groupKey, blueprintKey, inputKey, entry } of allMappingEntries()) {
      const source = entry.source as keyof typeof SOURCE_BUCKETS;
      // production ⇔ NOT applied-scoped; delivery/stored ⇔ applied-scoped.
      expect(
        entry.bucket === "production",
        `${groupKey}/${blueprintKey}/${inputKey}: bucket "${entry.bucket}" disagrees with SOURCE_BUCKETS scoping for source "${String(entry.source)}"`,
      ).toBe(!isAppliedScopedSource(source));
    }
  });

  it("pins the §8.6.2 bucket per (group, blueprint, input) tuple", () => {
    const expected: Record<string, EmissionInputBucket> = {
      "co2-stored/carbon_rich_substance_sequestration/carbon_content": "stored",
      "co2-stored/carbon_rich_substance_sequestration/product_mass": "stored",
      "biomass-feedstock-transport/mass_distance_based_ci_emissions/mass_distance":
        "production",
      "biomass-feedstock-transport/specific_volume_based_emissions/feedstock_mass":
        "production",
      "biochar-transport/mass_distance_based_ci_emissions/mass_distance":
        "delivery",
      "biochar-transport/specific_volume_based_emissions/feedstock_mass":
        "delivery",
      "sampling-required-for-mrv/mass_distance_based_ci_emissions/mass_distance":
        "production",
      "pyrolysis/grid_electricity_use/electricity_use": "production",
      "pyrolysis/fuel_usage_by_volume/volume_of_fuel": "production",
      "miscellaneous/mass_based_ci_emissions/mass": "stored",
    };

    const actual = Object.fromEntries(
      allMappingEntries().map(({ groupKey, blueprintKey, inputKey, entry }) => [
        `${groupKey}/${blueprintKey}/${inputKey}`,
        entry.bucket,
      ]),
    );
    expect(actual).toEqual(expected);
  });
});
