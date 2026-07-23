import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRemovalWithBatchesAction } from "./create-removal-with-batches";

const mocks = vi.hoisted(() => ({
  buildCreditBatchContexts: vi.fn(),
  createRemovalWithCreditBatches: vi.fn(),
  loadFacilityCertifierFacts: vi.fn(),
  requireOrgContext: vi.fn(),
  requireOrgFacility: vi.fn(),
}));

vi.mock("@/data-access/certifier-removals", () => ({
  createRemovalWithCreditBatches: mocks.createRemovalWithCreditBatches,
}));

vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: mocks.requireOrgFacility,
}));

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mocks.requireOrgContext,
}));

vi.mock("@/lib/log", () => ({
  logger: {
    child: () => ({ info: vi.fn() }),
  },
}));

vi.mock("@/fn/certification/certify-context-core", () => ({
  buildCreditBatchContexts: mocks.buildCreditBatchContexts,
  loadFacilityCertifierFacts: mocks.loadFacilityCertifierFacts,
}));

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const CREDIT_BATCH_ID = "00000000-0000-4000-8000-000000000002";
const ORG_CONTEXT = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "admin",
  isPlatformAdmin: false,
} as const;

describe("createRemovalWithBatchesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgContext.mockResolvedValue(ORG_CONTEXT);
    mocks.loadFacilityCertifierFacts.mockResolvedValue({
      hasOrgCredentials: false,
      mapping: null,
      defaultTemplate: null,
      missingDefaultTemplateId: null,
      unresolvedBlueprintKeys: [],
    });
  });

  it("rejects incomplete facility setup before grouping any batches", async () => {
    const result = await createRemovalWithBatchesAction({
      facilityId: FACILITY_ID,
      creditBatchIds: [CREDIT_BATCH_ID],
    });

    expect(result).toEqual({
      success: false,
      error:
        "Complete this facility's certification setup before grouping credit batches.",
    });
    expect(mocks.requireOrgFacility).toHaveBeenCalledWith(
      ORG_CONTEXT,
      FACILITY_ID,
    );
    expect(mocks.buildCreditBatchContexts).not.toHaveBeenCalled();
    expect(mocks.createRemovalWithCreditBatches).not.toHaveBeenCalled();
  });
});
