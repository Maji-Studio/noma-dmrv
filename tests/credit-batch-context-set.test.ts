import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCreditBatchAccounting } from "@/data-access/credit-batch-accounting";
import {
  buildCreditBatchContexts,
  type FacilityCertifierFacts,
} from "@/fn/certification/certify-context-core";
import {
  loadLinkedGhgStatementStatus,
} from "@/fn/certification/linked-ghg-statement-status";
import { loadDurabilityBatchData } from "@/fn/certification/durability-readiness";
import { makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/data-access/credit-batch-accounting", () => ({
  loadCreditBatchAccounting: vi.fn(),
}));

vi.mock("@/fn/certification/linked-ghg-statement-status", () => ({
  loadLinkedGhgStatementStatus: vi.fn(),
}));

vi.mock("@/fn/certification/durability-readiness", () => ({
  loadDurabilityBatchData: vi.fn(),
}));

const mockedLoadAccounting = vi.mocked(loadCreditBatchAccounting);
const mockedLoadLinkedGhgStatementStatus = vi.mocked(
  loadLinkedGhgStatementStatus,
);
const mockedLoadDurabilityBatchData = vi.mocked(loadDurabilityBatchData);
const FANOUT_CONCURRENCY = 8;
const BATCH_IDS = Array.from(
  { length: FANOUT_CONCURRENCY + 1 },
  (_, index) => `batch-${index + 1}`,
);
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
    mockedLoadDurabilityBatchData.mockResolvedValue({
      batchesWithSamples: [],
      blockers: [],
      warnings: [],
      blockersByBatchId: {},
    });
  });

  it("loads accounting once and preserves order across the fanout boundary", async () => {
    mockedLoadAccounting.mockResolvedValue(
      Object.fromEntries(
        BATCH_IDS.map((batchId) => [batchId, accountingRecord(batchId)]),
      ) as never,
    );
    const pendingResolvers = new Map<string, () => void>();
    const completionOrder: string[] = [];
    let invocationIndex = 0;
    mockedLoadLinkedGhgStatementStatus.mockImplementation(
      async () => {
        const batchId = BATCH_IDS[invocationIndex++];
        await new Promise<void>((resolve) => {
          pendingResolvers.set(batchId, resolve);
        });
        completionOrder.push(batchId);
        return null as never;
      },
    );
    const orgCtx = makeTestOrgContext("user-1");

    const resultPromise = buildCreditBatchContexts(
      orgCtx,
      BATCH_IDS,
      facilityFacts,
    );

    await vi.waitFor(() => {
      expect(mockedLoadLinkedGhgStatementStatus).toHaveBeenCalledTimes(
        FANOUT_CONCURRENCY,
      );
    });
    for (const batchId of BATCH_IDS.slice(0, FANOUT_CONCURRENCY).reverse()) {
      pendingResolvers.get(batchId)?.();
    }
    await vi.waitFor(() => {
      expect(mockedLoadLinkedGhgStatementStatus).toHaveBeenCalledTimes(
        BATCH_IDS.length,
      );
    });
    pendingResolvers.get(BATCH_IDS[FANOUT_CONCURRENCY])?.();

    const result = await resultPromise;

    expect(mockedLoadAccounting).toHaveBeenCalledTimes(1);
    expect(mockedLoadAccounting).toHaveBeenCalledWith(orgCtx, BATCH_IDS);
    expect(completionOrder).toEqual([
      ...BATCH_IDS.slice(0, FANOUT_CONCURRENCY).reverse(),
      BATCH_IDS[FANOUT_CONCURRENCY],
    ]);
    expect(Object.keys(result.contextsByBatch)).toEqual(BATCH_IDS);
    expect(result.contextsByBatch["batch-1"].facilityId).toBe(FACILITY_ID);
  });
});
