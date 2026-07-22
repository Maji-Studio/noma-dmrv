import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCo2eStoredPreviews } from "@/data-access/credit-batches";
import { loadCreditBatchLineageFacts } from "@/data-access/credit-batch-lineage-facts";
import { listUngroupedCreditBatches } from "@/data-access/certifier-removals";
import type { OrgContext } from "@/lib/auth/server";
import { buildSelectableBatchesData } from "@/fn/certification/selectable-batches";

vi.mock("@/data-access/certifier-removals", () => ({
  listUngroupedCreditBatches: vi.fn(),
}));

vi.mock("@/data-access/credit-batch-lineage-facts", () => ({
  loadCreditBatchLineageFacts: vi.fn(),
}));

// Deliberately NOT mocked: @/data-access/credit-batch-production-runs. The
// rollups must be projected from the already-loaded facts — a mocked
// getApplicationRollupsByBatchIds hid a second lineage walk (review finding
// on #510). If the implementation regresses to calling it, this suite fails
// because the unmocked module needs a real DB context.

vi.mock("@/data-access/credit-batches", () => ({
  getCo2eStoredPreviews: vi.fn(),
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
const mockedLoadLineageFacts = vi.mocked(loadCreditBatchLineageFacts);
const mockedGetPreviews = vi.mocked(getCo2eStoredPreviews);
const FANOUT_BOUNDARY_BATCH_COUNT = 9;

describe("buildSelectableBatchesData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads lineage once and shares the facts with previews, rollups, and batch contexts", async () => {
    const orgCtx: OrgContext = {
      userId: "user-1",
      organizationId: "org-1",
      orgRole: "owner",
      isPlatformAdmin: false,
    };
    const facilityFacts = { mapping: { id: "mapping-1" } };
    const batchRows = [
      { id: "batch-1", code: "CB-1" },
      { id: "batch-2", code: "CB-2" },
    ];
    const lineageFactsByBatch = {
      "batch-1": {
        batchId: "batch-1",
        applicationIds: ["app-1"],
        appliedWeightTons: 1.25,
      },
      "batch-2": {
        batchId: "batch-2",
        applicationIds: ["app-2"],
        appliedWeightTons: 2.5,
      },
    };
    // The rollups the implementation must PROJECT from the facts above —
    // not fetch via getApplicationRollupsByBatchIds (second lineage walk).
    const projectedRollups = {
      "batch-1": { applicationIds: ["app-1"], appliedWeightTons: 1.25 },
      "batch-2": { applicationIds: ["app-2"], appliedWeightTons: 2.5 },
    };
    const previews = {
      "batch-1": { co2eStoredTonnes: 3.75 },
      "batch-2": { co2eStoredTonnes: 7.5 },
    };

    mockedListUngrouped.mockResolvedValue(batchRows as never);
    mockedLoadLineageFacts.mockResolvedValue(lineageFactsByBatch as never);
    mockedGetPreviews.mockResolvedValue(previews as never);
    const buildCreditBatchContext = vi.fn(async () => ({} as never));

    const result = await buildSelectableBatchesData(
      orgCtx,
      "facility-1",
      facilityFacts as never,
      buildCreditBatchContext,
    );

    expect(mockedLoadLineageFacts).toHaveBeenCalledTimes(1);
    expect(mockedLoadLineageFacts).toHaveBeenCalledWith(
      orgCtx,
      ["batch-1", "batch-2"],
    );
    expect(mockedGetPreviews).toHaveBeenCalledWith(
      orgCtx,
      ["batch-1", "batch-2"],
      { applicationRollups: projectedRollups, lineageFactsByBatch },
    );
    expect(buildCreditBatchContext).toHaveBeenCalledTimes(2);
    expect(buildCreditBatchContext).toHaveBeenNthCalledWith(
      1,
      orgCtx,
      "batch-1",
      facilityFacts,
      lineageFactsByBatch["batch-1"],
    );
    expect(buildCreditBatchContext).toHaveBeenNthCalledWith(
      2,
      orgCtx,
      "batch-2",
      facilityFacts,
      lineageFactsByBatch["batch-2"],
    );
    expect(result).toMatchObject({
      batches: [
        { id: "batch-1", appliedWeightTons: 1.25, co2eStoredTonnes: 3.75 },
        { id: "batch-2", appliedWeightTons: 2.5, co2eStoredTonnes: 7.5 },
      ],
    });
  });

  it("preserves batch order across the fanout chunk boundary", async () => {
    const orgCtx: OrgContext = {
      userId: "user-1",
      organizationId: "org-1",
      orgRole: "owner",
      isPlatformAdmin: false,
    };
    const facilityFacts = { mapping: { id: "mapping-1" } };
    const batchRows = Array.from(
      { length: FANOUT_BOUNDARY_BATCH_COUNT },
      (_, index) => ({
        id: `batch-${index + 1}`,
        code: `CB-${index + 1}`,
      }),
    );
    const batchIds = batchRows.map(({ id }) => id);
    const pendingResolvers = new Map<string, () => void>();
    const completionOrder: string[] = [];

    mockedListUngrouped.mockResolvedValue(batchRows as never);
    mockedLoadLineageFacts.mockResolvedValue({});
    mockedGetPreviews.mockResolvedValue({});
    const buildCreditBatchContext = vi.fn(
      async (_orgCtx: OrgContext, batchId: string) => {
        await new Promise<void>((resolve) => {
          pendingResolvers.set(batchId, resolve);
        });
        completionOrder.push(batchId);
        return {} as never;
      },
    );

    const resultPromise = buildSelectableBatchesData(
      orgCtx,
      "facility-1",
      facilityFacts as never,
      buildCreditBatchContext,
    );

    await vi.waitFor(() => {
      expect(buildCreditBatchContext).toHaveBeenCalledTimes(8);
    });
    for (const batchId of batchIds.slice(0, 8).reverse()) {
      pendingResolvers.get(batchId)?.();
    }
    await vi.waitFor(() => {
      expect(buildCreditBatchContext).toHaveBeenCalledTimes(9);
    });
    pendingResolvers.get(batchIds[8])?.();

    const result = await resultPromise;

    expect(completionOrder).toEqual([
      ...batchIds.slice(0, 8).reverse(),
      batchIds[8],
    ]);
    expect(
      buildCreditBatchContext.mock.calls.map(([, batchId]) => batchId),
    ).toEqual(batchIds);
    expect(result.batches.map(({ id }) => id)).toEqual(batchIds);
  });
});
