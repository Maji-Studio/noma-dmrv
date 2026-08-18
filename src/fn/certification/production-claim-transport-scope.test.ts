import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
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
    feedstocks: [{ id: args.feedstockId }],
  } as ChainOfCustodyData;
}

function batchWithSample(
  creditBatchId: string,
  sampleId: string,
): CreditBatchWithSamples {
  return {
    creditBatchId,
    samples: [{ id: sampleId }],
  } as unknown as CreditBatchWithSamples;
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
        batchesWithSamples: [
          batchWithSample("batch-prior", "sample-prior"),
          batchWithSample("batch-unclaimed", "sample-unclaimed"),
        ],
      }),
    ).toEqual({
      feedstockIds: ["feedstock-unclaimed", "batch-unclaimed-feedstock"],
      biocharProductIds: ["product-prior", "product-unclaimed"],
      sampleIds: ["sample-unclaimed"],
    });
  });
});
