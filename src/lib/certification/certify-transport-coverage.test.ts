import { transportCategoryCovered } from "@/lib/certification/readiness";
import { batchAutomaticFigures } from "@/lib/certification/batch-automatic-figures";
import { collectProductionClaimAwareTransportEntityIds } from "./production-claim-transport-scope";
import { buildSubmissionLineageBlockers } from "./certify-lineage-blockers";
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

it("does not block a later batch whose linked-but-not-owned feedstock has no legs", () => {
  const ids = collectProductionClaimAwareTransportEntityIds({
    removalId: null,
    memberBatches: [{ id: "later", productionRunIds: ["later-run"], productionFeedstockIds: [],
      productionHasLinkedFeedstock: true, productionEmissionsClaimedByRemovalId: null }],
    lineages: [],
  });
  const legs = { feedstock: [], biochar: [], sample: [], feedstockTransportOwnedElsewhere: ids.feedstockTransportOwnedElsewhere };
  const coverage = buildTransportCoverage(legs, ids);
  expect(coverage.feedstock).toMatchObject({ count: 0, missingEntityIds: [], ownedElsewhere: true });
  expect(transportCategoryCovered(coverage.feedstock)).toBe(true);
  expect(buildSubmissionLineageBlockers([], coverage.feedstock.missingEntityIds ?? [], {}, ["feedstock"])).toEqual([]);
  expect(batchAutomaticFigures([], legs)["feedstock-transport"]).toEqual({ magnitude: "0", unit: "km * tonne" });
});
