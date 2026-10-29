import { transportCategoryCovered } from "@/lib/certification/readiness";
import { batchAutomaticFigures } from "@/lib/certification/batch-automatic-figures";
import { describe, expect, it } from "vitest";
import { buildTransportCoverage } from "./certify-transport-coverage";
import type { TransportLegsByCategory } from "./shared";

const entityIds = { feedstockIds: ["FS-1", "FS-2", "FS-3"], biocharProductIds: [], sampleIds: [] };

describe("per-feedstock transport coverage", () => {
  it("does not let one usable leg cover other feedstocks", () => {
    const legs = {
      feedstock: [{ id: "leg-1", entityId: "FS-1", distanceKm: 10, loadMassKg: 100, calculationMethodType: "distance_based", transportMethodType: "road" }],
      biochar: [],
      sample: [],
    } as unknown as TransportLegsByCategory;
    expect(buildTransportCoverage(legs, entityIds).feedstock).toMatchObject({
      count: 1,
      missingEntityIds: ["FS-2", "FS-3"],
    });
  });
});

it("carries owned-elsewhere evidence from the entity scope into feedstock coverage only", () => {
  const coverage = buildTransportCoverage({ feedstock: [], biochar: [], sample: [] }, {
    feedstockIds: [], biocharProductIds: [], sampleIds: [], feedstockTransportOwnedElsewhere: true,
  });
  expect(coverage.feedstock).toMatchObject({ count: 0, ownedElsewhere: true, missingEntityIds: [] });
  expect(coverage.biochar.ownedElsewhere).toBeUndefined();
  expect(coverage.sample.ownedElsewhere).toBeUndefined();
});


it.each([false, true])("requires linked feedstock presence without counting another batch's legs: %s", (hasLeg) => {
  const legs = { feedstock: [], biochar: [], sample: [], feedstockTransportOwnedElsewhere: true };
  const coverage = buildTransportCoverage(legs, {
    feedstockIds: [], linkedFeedstockIds: ["earlier-stock"], biocharProductIds: [], sampleIds: [],
    feedstockTransportOwnedElsewhere: true,
  }, hasLeg ? [{ entityId: "earlier-stock", distanceKm: 10, loadMassKg: 1000 }] : []);
  expect(coverage.feedstock).toMatchObject({
    count: 0, legIds: [], entityIds: [], ownedElsewhere: true,
    missingEntityIds: hasLeg ? [] : ["earlier-stock"],
  });
  expect(transportCategoryCovered(coverage.feedstock)).toBe(hasLeg);
  expect(batchAutomaticFigures([], legs)["feedstock-transport"]).toEqual({ magnitude: "0", unit: "km * tonne" });
});
