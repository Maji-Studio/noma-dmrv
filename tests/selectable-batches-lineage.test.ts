import { beforeEach, describe, expect, it, vi } from "vitest";
import { listUngroupedCreditBatches } from "@/data-access/certifier-removals";
import type { OrgContext } from "@/lib/auth/server";
import { buildSelectableBatchesData } from "@/fn/certification/selectable-batches";

vi.mock("@/data-access/certifier-removals", () => ({
  listUngroupedCreditBatches: vi.fn(),
}));

vi.mock("@/lib/certification/batch-health", () => ({
  deriveBatchHealth: vi.fn(() => ({
    state: "ready",
    checks: [],
    issueCount: 0,
  })),
}));

vi.mock("@/lib/certification/batch-health-facts", () => ({
  toBatchHealthFacts: vi.fn(() => ({})),
}));

vi.mock("@/lib/certification/facility-setup-gaps", () => ({
  deriveFacilitySetupGaps: vi.fn(() => []),
}));

const mockedListUngrouped = vi.mocked(listUngroupedCreditBatches);

const orgCtx: OrgContext = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "owner",
  isPlatformAdmin: false,
};

function accountingRecord(
  batchId: string,
  appliedWeightTons: number,
  co2eStoredTonnes: number,
) {
  return {
    appliedWeightTons,
    co2ePreview: { co2eStoredTonnes },
    batch: { id: batchId },
    lineageFacts: { batchId },
  };
}

describe("buildSelectableBatchesData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requests one set of accounting-backed contexts for the whole wizard render", async () => {
    const facilityFacts = { mapping: { id: "mapping-1" } };
    const batchRows = [
      { id: "batch-1", code: "CB-1" },
      { id: "batch-2", code: "CB-2" },
    ];
    const buildCreditBatchContexts = vi.fn(async () => ({
      accountingByBatch: {
        "batch-1": accountingRecord("batch-1", 1.25, 3.75),
        "batch-2": accountingRecord("batch-2", 2.5, 7.5),
      },
      contextsByBatch: {
        "batch-1": {},
        "batch-2": {},
      },
    }));

    mockedListUngrouped.mockResolvedValue(batchRows as never);

    const result = await buildSelectableBatchesData(
      orgCtx,
      "facility-1",
      facilityFacts as never,
      buildCreditBatchContexts as never,
    );

    expect(buildCreditBatchContexts).toHaveBeenCalledTimes(1);
    expect(buildCreditBatchContexts).toHaveBeenCalledWith(
      orgCtx,
      ["batch-1", "batch-2"],
      facilityFacts,
    );
    expect(result).toMatchObject({
      batches: [
        { id: "batch-1", appliedWeightTons: 1.25, co2eStoredTonnes: 3.75 },
        { id: "batch-2", appliedWeightTons: 2.5, co2eStoredTonnes: 7.5 },
      ],
    });
  });

  it("preserves list order when accounting results are keyed independently", async () => {
    const batchRows = [
      { id: "batch-2", code: "CB-2" },
      { id: "batch-1", code: "CB-1" },
    ];
    mockedListUngrouped.mockResolvedValue(batchRows as never);

    const result = await buildSelectableBatchesData(
      orgCtx,
      "facility-1",
      {} as never,
      vi.fn(async () => ({
        accountingByBatch: {
          "batch-1": accountingRecord("batch-1", 1, 10),
          "batch-2": accountingRecord("batch-2", 2, 20),
        },
        contextsByBatch: {
          "batch-1": {},
          "batch-2": {},
        },
      })) as never,
    );

    expect(result.batches.map(({ id }) => id)).toEqual([
      "batch-2",
      "batch-1",
    ]);
  });
});
