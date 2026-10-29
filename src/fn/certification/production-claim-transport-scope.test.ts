import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  collectProductionClaimAwareRequiredTransportCategories,
  collectProductionClaimAwareTransportEntityIds,
} from "./production-claim-transport-scope";

const REQUIRED = ["feedstock", "biochar", "sample"] as const;
const CURRENT_REMOVAL_ID = "00000000-0000-4000-a000-000000000001";
const PRIOR_REMOVAL_ID = "00000000-0000-4000-a000-000000000002";

function batch(id: string, claimedBy: string | null, productionRunId = `${id}-run`) {
  return {
    id,
    productionRunIds: [productionRunId],
    productionFeedstockIds: [`${id}-feedstock`],
    productionEmissionsClaimedByRemovalId: claimedBy,
  };
}

function lineage(args: {
  productionRunId: string;
  biocharProductId: string;
  feedstockId: string;
}): ChainOfCustodyData {
  return {
    productionRun: { id: args.productionRunId },
    biocharProduct: { id: args.biocharProductId },
    feedstocks: [{ id: args.feedstockId, ownsTransport: true }],
  } as ChainOfCustodyData;
}

describe("production-claim-aware transport requirements", () => {
  it("keeps only application delivery transport after another Removal claimed production", () => {
    expect(
      collectProductionClaimAwareRequiredTransportCategories({
        removalId: CURRENT_REMOVAL_ID,
        memberBatches: [batch("batch-prior", PRIOR_REMOVAL_ID)],
        requiredTransportCategories: REQUIRED,
      }),
    ).toEqual(["biochar"]);
  });

  it.each([null, CURRENT_REMOVAL_ID])(
    "keeps production transport when the claim belongs to %s",
    (claimedBy) => {
      expect(
        collectProductionClaimAwareRequiredTransportCategories({
          removalId: CURRENT_REMOVAL_ID,
          memberBatches: [batch("batch-current", claimedBy)],
          requiredTransportCategories: REQUIRED,
        }),
      ).toEqual(REQUIRED);
    },
  );

  it("keeps production transport for a mixed claim set", () => {
    expect(
      collectProductionClaimAwareRequiredTransportCategories({
        removalId: CURRENT_REMOVAL_ID,
        memberBatches: [
          batch("batch-prior", PRIOR_REMOVAL_ID),
          batch("batch-unclaimed", null),
        ],
        requiredTransportCategories: REQUIRED,
      }),
    ).toEqual(REQUIRED);
  });

  it("still requires feedstock coverage when a production-claiming batch has no owned feedstock IDs", () => {
    expect(collectProductionClaimAwareRequiredTransportCategories({
      removalId: CURRENT_REMOVAL_ID,
      memberBatches: [{ ...batch("later", null), productionFeedstockIds: [] }],
      requiredTransportCategories: ["feedstock", "biochar"],
    })).toEqual(["feedstock", "biochar"]);
  });

  it("does not reintroduce transport owned by an earlier run through lineage", () => {
    const later = lineage({ productionRunId: "later", biocharProductId: "product", feedstockId: "earlier-stock" });
    later.feedstocks[0].ownsTransport = false;
    expect(collectProductionClaimAwareTransportEntityIds({
      removalId: CURRENT_REMOVAL_ID,
      memberBatches: [{ ...batch("later-batch", null, "later"), productionFeedstockIds: [] }],
      lineages: [later],
    })).toEqual({ feedstockIds: [], linkedFeedstockIds: ["earlier-stock"], feedstockTransportOwnedElsewhere: true, biocharProductIds: ["product"], sampleIds: [] });
  });

  it("keeps production transport IDs from unclaimed batches and biochar IDs from every lineage", () => {
    expect(
      collectProductionClaimAwareTransportEntityIds({
        removalId: CURRENT_REMOVAL_ID,
        memberBatches: [
          batch("batch-prior", PRIOR_REMOVAL_ID, "run-prior"),
          batch("batch-unclaimed", null, "run-unclaimed"),
        ],
        lineages: [
          lineage({
            productionRunId: "run-prior",
            biocharProductId: "product-prior",
            feedstockId: "feedstock-prior",
          }),
          lineage({
            productionRunId: "run-unclaimed",
            biocharProductId: "product-unclaimed",
            feedstockId: "feedstock-unclaimed",
          }),
        ],
      }),
    ).toEqual({
      feedstockIds: ["feedstock-unclaimed", "batch-unclaimed-feedstock"],
      linkedFeedstockIds: ["feedstock-unclaimed", "batch-unclaimed-feedstock"],
      biocharProductIds: ["product-prior", "product-unclaimed"],
      sampleIds: [],
    });
  });
});


it.each([null, CURRENT_REMOVAL_ID, PRIOR_REMOVAL_ID])("carries linked feedstock from unapplied runs only when production is claimed here: %s", (claimedBy) => {
  const ids = collectProductionClaimAwareTransportEntityIds({
    removalId: CURRENT_REMOVAL_ID,
    memberBatches: [{ ...batch("later", claimedBy), productionFeedstockIds: [], productionLinkedFeedstockIds: ["earlier-stock"], productionHasLinkedFeedstock: true }],
    lineages: [],
  });
  expect(ids.feedstockIds).toEqual([]);
  expect(ids.linkedFeedstockIds).toEqual(claimedBy === PRIOR_REMOVAL_ID ? [] : ["earlier-stock"]);
  expect(ids.feedstockTransportOwnedElsewhere === true).toBe(claimedBy !== PRIOR_REMOVAL_ID);
});

it("does not turn missing owned legs or wholly absent feedstock into zero", () => {
  for (const member of [batch("owned", null), { ...batch("absent", null), productionFeedstockIds: [] }]) {
    expect(collectProductionClaimAwareTransportEntityIds({
      removalId: CURRENT_REMOVAL_ID, memberBatches: [member], lineages: [],
    }).feedstockTransportOwnedElsewhere).toBeUndefined();
  }
});


it("keeps the zero feedstock figure in the claiming Removal's ledger preview categories", () => {
  expect(collectProductionClaimAwareRequiredTransportCategories({
    removalId: CURRENT_REMOVAL_ID,
    memberBatches: [{ ...batch("later", null), productionFeedstockIds: [], productionHasLinkedFeedstock: true }],
    requiredTransportCategories: ["feedstock", "biochar"],
  })).toEqual(["feedstock", "biochar"]);
});
