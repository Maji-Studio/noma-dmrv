import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({
  getCertifierRemovalById: vi.fn(),
  getCreditBatchSummariesByRemovalIds: vi.fn(),
  getProductionBatchRegistrations: vi.fn(),
}));

const ORG_CTX = {
  userId: "user-test-1",
  organizationId: "org-test-1",
  orgRole: "owner",
  isPlatformAdmin: false,
} as OrgContext;

vi.mock("../with-action", () => ({
  withAction: async <T>(fn: (ctx: OrgContext) => Promise<T>) => {
    try {
      return { success: true as const, data: await fn(ORG_CTX) };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Unexpected error",
      };
    }
  },
}));

vi.mock("@/data-access/certifier-production-batches", () => ({
  getProductionBatchRegistrations: mocks.getProductionBatchRegistrations,
}));

vi.mock("@/data-access/certifier-removals", () => ({
  getCertifierRemovalById: mocks.getCertifierRemovalById,
  getCreditBatchSummariesByRemovalIds:
    mocks.getCreditBatchSummariesByRemovalIds,
}));

import { loadRemovalProductionBatches } from "./removal-production-batches";

const REMOVAL_ID = "00000000-0000-4000-8000-000000000001";
const BATCH_A_ID = "00000000-0000-4000-8000-00000000000a";
const BATCH_B_ID = "00000000-0000-4000-8000-00000000000b";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCertifierRemovalById.mockResolvedValue({ id: REMOVAL_ID });
});

describe("loadRemovalProductionBatches", () => {
  it("rejects an invalid Removal UUID before data access", async () => {
    const result = await loadRemovalProductionBatches("not-a-uuid");

    expect(result.success).toBe(false);
    expect(mocks.getCertifierRemovalById).not.toHaveBeenCalled();
    expect(mocks.getCreditBatchSummariesByRemovalIds).not.toHaveBeenCalled();
    expect(mocks.getProductionBatchRegistrations).not.toHaveBeenCalled();
  });

  it("returns an empty list when the Removal has no member credit batches", async () => {
    mocks.getCreditBatchSummariesByRemovalIds.mockResolvedValue(new Map());

    await expect(loadRemovalProductionBatches(REMOVAL_ID)).resolves.toEqual({
      success: true,
      data: [],
    });
    expect(mocks.getProductionBatchRegistrations).not.toHaveBeenCalled();
  });

  it("returns an empty list when no member credit batch is registered", async () => {
    mocks.getCreditBatchSummariesByRemovalIds.mockResolvedValue(
      new Map([[REMOVAL_ID, [{ id: BATCH_A_ID, code: "CB-2026-001" }]]]),
    );
    mocks.getProductionBatchRegistrations.mockResolvedValue([]);

    await expect(loadRemovalProductionBatches(REMOVAL_ID)).resolves.toEqual({
      success: true,
      data: [],
    });
  });

  it("labels registered members by credit-batch code and sorts by code", async () => {
    mocks.getCreditBatchSummariesByRemovalIds.mockResolvedValue(
      new Map([
        [
          REMOVAL_ID,
          [
            { id: BATCH_B_ID, code: "CB-2026-002" },
            { id: BATCH_A_ID, code: "CB-2026-001" },
          ],
        ],
      ]),
    );
    mocks.getProductionBatchRegistrations.mockResolvedValue([
      {
        creditBatchId: BATCH_B_ID,
        externalProductionBatchId: "ptb_second",
        externalProjectId: "prj_second",
        externalFacilityId: "fcl_second",
      },
      {
        creditBatchId: BATCH_A_ID,
        externalProductionBatchId: "ptb_first",
        externalProjectId: "prj_first",
        externalFacilityId: "fcl_first",
      },
    ]);

    await expect(loadRemovalProductionBatches(REMOVAL_ID)).resolves.toEqual({
      success: true,
      data: [
        {
          creditBatchId: BATCH_A_ID,
          creditBatchCode: "CB-2026-001",
          externalProductionBatchId: "ptb_first",
          externalProjectId: "prj_first",
          externalFacilityId: "fcl_first",
        },
        {
          creditBatchId: BATCH_B_ID,
          creditBatchCode: "CB-2026-002",
          externalProductionBatchId: "ptb_second",
          externalProjectId: "prj_second",
          externalFacilityId: "fcl_second",
        },
      ],
    });
  });
});
