import { describe, expect, it } from "vitest";
import { collectProductionClaimAwareRequiredTransportCategories } from "./production-claim-transport-scope";

const REQUIRED = ["feedstock", "biochar", "sample"] as const;
const CURRENT_REMOVAL_ID = "00000000-0000-4000-a000-000000000001";
const PRIOR_REMOVAL_ID = "00000000-0000-4000-a000-000000000002";

function batch(claimedBy: string | null) {
  return {
    id: "00000000-0000-4000-a000-000000000003",
    productionRunIds: ["00000000-0000-4000-a000-000000000004"],
    productionEmissionsClaimedByRemovalId: claimedBy,
  };
}

describe("production-claim-aware transport requirements", () => {
  it("keeps only application delivery transport after another Removal claimed production", () => {
    expect(
      collectProductionClaimAwareRequiredTransportCategories({
        removalId: CURRENT_REMOVAL_ID,
        memberBatches: [batch(PRIOR_REMOVAL_ID)],
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
          memberBatches: [batch(claimedBy)],
          requiredTransportCategories: REQUIRED,
        }),
      ).toEqual(REQUIRED);
    },
  );

  it("keeps production transport for a mixed claim set", () => {
    expect(
      collectProductionClaimAwareRequiredTransportCategories({
        removalId: CURRENT_REMOVAL_ID,
        memberBatches: [batch(PRIOR_REMOVAL_ID), batch(null)],
        requiredTransportCategories: REQUIRED,
      }),
    ).toEqual(REQUIRED);
  });
});
