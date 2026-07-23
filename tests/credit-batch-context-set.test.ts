import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCreditBatchAccounting } from "@/data-access/credit-batch-accounting";
import {
  buildCreditBatchContexts,
  type FacilityCertifierFacts,
} from "@/fn/certification/certify-context-core";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/data-access/credit-batch-accounting", () => ({
  loadCreditBatchAccounting: vi.fn(),
}));

const mockedLoadAccounting = vi.mocked(loadCreditBatchAccounting);
const BATCH_IDS = ["batch-1", "batch-2"];
const FACILITY_ID = "facility-1";

const facilityFacts = {
  hasOrgCredentials: true,
  mapping: null,
  project: null,
  defaultTemplate: null,
  missingDefaultTemplateId: null,
  blueprintsForTemplate: [],
  unresolvedBlueprintKeys: [],
  requiredTransportCategories: [],
} as FacilityCertifierFacts;

const accountingRecord = (batchId: string) => ({
  batch: {
    id: batchId,
    code: batchId.toUpperCase(),
    facilityId: FACILITY_ID,
    removalId: null,
    durabilityOption: "200_year",
    productionEmissionsClaimedByRemovalId: null,
  },
  lineageFacts: {
    batchId,
    productionRunIds: [],
    runs: [],
    applications: [],
    applicationIds: [],
    appliedWeightTons: 0,
  },
  appliedWeightTons: 0,
  co2ePreview: {},
});

describe("buildCreditBatchContexts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads accounting once for the complete wizard batch set", async () => {
    mockedLoadAccounting.mockResolvedValue(
      Object.fromEntries(
        BATCH_IDS.map((batchId) => [batchId, accountingRecord(batchId)]),
      ) as never,
    );
    const orgCtx = makeTestOrgContext("user-1");

    const result = await buildCreditBatchContexts(
      orgCtx,
      BATCH_IDS,
      facilityFacts,
    );

    expect(mockedLoadAccounting).toHaveBeenCalledTimes(1);
    expect(mockedLoadAccounting).toHaveBeenCalledWith(orgCtx, BATCH_IDS);
    expect(Object.keys(result.contextsByBatch)).toEqual(BATCH_IDS);
    expect(result.contextsByBatch["batch-1"].facilityId).toBe(FACILITY_ID);
  });
});
