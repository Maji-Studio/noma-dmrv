import { removalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import { buildSelectableBatchesData } from "./selectable-batches";
import { unsupportedTemplate } from "../../../tests/fixtures/isometric/unsupported-template";
import { findUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRemovalWithBatchesAction } from "./create-removal-with-batches";

const mocks = vi.hoisted(() => ({
  listUngroupedCreditBatches: vi.fn(),
  buildCreditBatchContexts: vi.fn(),
  createRemovalWithCreditBatches: vi.fn(),
  loadFacilityCertifierFacts: vi.fn(),
  requireOrgContext: vi.fn(),
  requireOrgFacility: vi.fn(),
}));

vi.mock("@/data-access/certifier-removals", () => ({
  listUngroupedCreditBatches: mocks.listUngroupedCreditBatches,
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
      unbindableTemplateInputs: [],
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

const CONNECTED = {
  hasOrgCredentials: true, mapping: { externalFacilityId: "fcl-1" }, defaultTemplate: null,
  missingDefaultTemplateId: null, unresolvedBlueprintKeys: [], unbindableTemplateInputs: [],
};
function batchContext() {
  return {
    facilityId: FACILITY_ID, removalId: null, memberBatches: [{ id: CREDIT_BATCH_ID, code: "CB-1", removalTemplateId: "pinned-reviewed" }],
    mapping: CONNECTED.mapping, removalTemplate: { id: "pinned-reviewed" }, templateBlockers: [] as import("@/lib/certification/removal-template-blockers").RemovalTemplateBlocker[],
    unresolvedBlueprintKeys: [], unbindableTemplateInputs: [], hasSubmittableRuns: true,
    requiredTransportCategories: [], submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
  };
}
function contexts(context = batchContext()) {
  return { contextsByBatch: { [CREDIT_BATCH_ID]: context }, accountingByBatch: {} };
}

it.each([
  { defaultTemplate: null },
  { missingDefaultTemplateId: "deleted-default" },
  { unbindableTemplateInputs: findUnbindableTemplateInputs(unsupportedTemplate()) },
  { unresolvedBlueprintKeys: ["unknown_default_blueprint"] },
])("groups a ready pin regardless of default-template advice (%j)", async (advice) => {
  mocks.requireOrgContext.mockResolvedValue(ORG_CONTEXT);
  const facts = { ...CONNECTED, ...advice };
  mocks.loadFacilityCertifierFacts.mockResolvedValue(facts);
  mocks.buildCreditBatchContexts.mockResolvedValue(contexts());
  mocks.createRemovalWithCreditBatches.mockResolvedValue("removal-1");
  mocks.listUngroupedCreditBatches.mockResolvedValue([{ id: CREDIT_BATCH_ID }]);
  const result = await createRemovalWithBatchesAction({ facilityId: FACILITY_ID, creditBatchIds: [CREDIT_BATCH_ID] });
  expect(result).toEqual({ success: true, data: { removalId: "removal-1" } });
  const selectable = await buildSelectableBatchesData(ORG_CONTEXT, FACILITY_ID,
    facts as unknown as import("./facility-certifier-facts").FacilityCertifierFacts, mocks.buildCreditBatchContexts);
  expect(selectable.facilitySetupGaps).toEqual([]);
  expect(selectable.facilitySetupComplete).toBe(true);
  expect(selectable.batches[0].health.state).toBe("ready");
});

it("rejects an unready pin even when the facility default is clean", async () => {
  vi.clearAllMocks();
  mocks.requireOrgContext.mockResolvedValue(ORG_CONTEXT);
  const context = { ...batchContext(), templateBlockers: [removalTemplateBlocker("templateLinesNeedReview")] };
  mocks.loadFacilityCertifierFacts.mockResolvedValue({ ...CONNECTED, defaultTemplate: { id: "clean-default" } });
  mocks.buildCreditBatchContexts.mockResolvedValue(contexts(context));
  const result = await createRemovalWithBatchesAction({ facilityId: FACILITY_ID, creditBatchIds: [CREDIT_BATCH_ID] });
  expect(result.success).toBe(false);
  expect(mocks.createRemovalWithCreditBatches).not.toHaveBeenCalled();
  mocks.listUngroupedCreditBatches.mockResolvedValue([{ id: CREDIT_BATCH_ID }]);
  const selectable = await buildSelectableBatchesData(ORG_CONTEXT, FACILITY_ID,
    CONNECTED as unknown as import("./facility-certifier-facts").FacilityCertifierFacts, mocks.buildCreditBatchContexts);
  expect(selectable.facilitySetupComplete).toBe(true);
  expect(selectable.batches[0].health.state).toBe("incomplete");
});

it.each(["pinned-reviewed", "other-template"])("groups only a shared selection pin (%s)", async (secondPin) => {
  vi.clearAllMocks();
  const secondId = "00000000-0000-4000-8000-000000000003";
  const first = batchContext();
  const second = { ...batchContext(), memberBatches: [{ id: secondId, code: "CB-2", removalTemplateId: secondPin }] };
  mocks.requireOrgContext.mockResolvedValue(ORG_CONTEXT);
  mocks.loadFacilityCertifierFacts.mockResolvedValue(CONNECTED);
  mocks.buildCreditBatchContexts.mockResolvedValue({ contextsByBatch: { [CREDIT_BATCH_ID]: first, [secondId]: second }, accountingByBatch: {} });
  mocks.createRemovalWithCreditBatches.mockResolvedValue("removal-1");
  const result = await createRemovalWithBatchesAction({ facilityId: FACILITY_ID, creditBatchIds: [CREDIT_BATCH_ID, secondId] });
  if (secondPin === "pinned-reviewed") {
    expect(result).toEqual({ success: true, data: { removalId: "removal-1" } });
    expect(mocks.createRemovalWithCreditBatches).toHaveBeenCalledOnce();
  } else {
    expect(result).toEqual({ success: false, error: "These credit batches use different Removal templates." });
    expect(mocks.createRemovalWithCreditBatches).not.toHaveBeenCalled();
  }
});
