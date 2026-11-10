import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalDisplay } from "@/data-access/credit-batch-removal-display";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("@/data-access/credit-batch-removal-display", () => ({ loadCreditBatchRemovalDisplays: vi.fn() }));
vi.mock("@/data-access/removal-latest-attempt", () => ({ getRemovalIdsWithChangedLatestAttempt: vi.fn() }));
vi.mock("@/data-access/certification-submissions", () => ({ hasFinalizedSubmission: vi.fn() }));
vi.mock("@/data-access/removal-deletion-lease", () => ({ getDeletionLeasedRemovalIds: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getCreditBatchesWithSamples: vi.fn(async () => []) }));
vi.mock("@/data-access/credit-batch-missing-production-runs", () => ({ loadCreditBatchesMissingProductionRuns: vi.fn(async () => new Map()) }));
vi.mock("@/lib/read-models/batches-emission-lines", () => ({ loadBatchesEmissionLines: vi.fn(async () => new Map()) }));
vi.mock("@/lib/certification/certify-context-core", () => ({
  loadFacilityCertifierFacts: vi.fn(async () => ({})),
  buildCreditBatchContexts: vi.fn(async () => ({ contextsByBatch: {
    "batch-1": { facilityId: "facility" }, "batch-2": { facilityId: "facility" },
  } })),
}));
vi.mock("@/lib/certification/batch-health-facts", () => ({ toBatchHealthFacts: vi.fn() }));
vi.mock("@/lib/certification/batch-health", () => ({
  deriveBatchHealth: vi.fn(() => ({ state: "ready", issueCount: 0, checks: [] })),
  batchLinesToDecide: vi.fn(() => 0),
}));

import { loadCreditBatchRemovalDisplays } from "@/data-access/credit-batch-removal-display";
import { getRemovalIdsWithChangedLatestAttempt } from "@/data-access/removal-latest-attempt";
import { hasFinalizedSubmission } from "@/data-access/certification-submissions";
import { getDeletionLeasedRemovalIds } from "@/data-access/removal-deletion-lease";
import { ASK_ADMIN_TO_DELETE, FINALIZED_NO_DELETE, OPEN_REMOVAL_TO_DELETE } from "@/lib/certification/interrupted-removal-copy";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/certification/shared";
import { loadCreditBatchTodos } from "./credit-batch-todos-core";

const ORG_CTX = makeTestOrgContext();
const BATCHES = ["batch-1", "batch-2"].map((id) => ({ id, removalTemplateId: null }));
const INTERRUPTED: RemovalDisplay = {
  id: "removal-1", code: "RM-26-003", phase: "draft",
  status: { kind: "interrupted", label: "Submission interrupted", value: "failed", isActionable: true, isTerminal: false },
};

describe("loadCreditBatchTodos interrupted attempt outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCreditBatchRemovalDisplays).mockResolvedValue(new Map(BATCHES.map(({ id }) => [id, [INTERRUPTED]])));
    vi.mocked(getRemovalIdsWithChangedLatestAttempt).mockImplementation(async (_ctx, removalIds) => new Set(removalIds.filter((removalId) => removalId === INTERRUPTED.id)));
    vi.mocked(hasFinalizedSubmission).mockResolvedValue(false);
    vi.mocked(getDeletionLeasedRemovalIds).mockResolvedValue(new Set());
  });

  it("refuses deletion after a superseded finalized version even when the changed draft phase is draft", async () => {
    vi.mocked(hasFinalizedSubmission).mockResolvedValue(true);
    const result = await loadCreditBatchTodos(ORG_CTX, "facility", BATCHES);
    expect(hasFinalizedSubmission).toHaveBeenCalledExactlyOnceWith(ORG_CTX, {
      provider: ISOMETRIC_PROVIDER, submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE, localEntityId: INTERRUPTED.id,
    });
    for (const todos of result.values()) expect(todos.check[0]?.instruction).toBe(FINALIZED_NO_DELETE);
  });

  it.each([
    { orgRole: "admin" as const, isPlatformAdmin: false, instruction: OPEN_REMOVAL_TO_DELETE },
    { orgRole: "member" as const, isPlatformAdmin: false, instruction: ASK_ADMIN_TO_DELETE },
    { orgRole: "member" as const, isPlatformAdmin: true, instruction: OPEN_REMOVAL_TO_DELETE },
  ])("uses registry deletion access for $orgRole, platform admin=$isPlatformAdmin", async ({ orgRole, isPlatformAdmin, instruction }) => {
    const result = await loadCreditBatchTodos({ ...ORG_CTX, orgRole, isPlatformAdmin }, "facility", BATCHES);
    for (const todos of result.values()) expect(todos.check[0]?.instruction).toBe(instruction);
  });

  it("reads each interrupted Removal once across batches and uses its newest outcome", async () => {
    const result = await loadCreditBatchTodos(ORG_CTX, "facility", BATCHES);
    expect(getRemovalIdsWithChangedLatestAttempt).toHaveBeenCalledExactlyOnceWith(ORG_CTX, [INTERRUPTED.id]);
    expect(getDeletionLeasedRemovalIds).toHaveBeenCalledExactlyOnceWith(ORG_CTX, [INTERRUPTED.id]);
    for (const todos of result.values()) {
      expect(todos.removalInterrupted).toBe(true);
      expect(todos.check[0]).toMatchObject({
        title: "RM-26-003: Changed since review",
        target: { href: "/removals?facility=facility&removal=removal-1" },
      });
    }
  });

  it("batches distinct interrupted Removals and applies each returned outcome to its own batch", async () => {
    const retry = { ...INTERRUPTED, id: "removal-2", code: "RM-26-004" };
    vi.mocked(loadCreditBatchRemovalDisplays).mockResolvedValue(new Map([
      ["batch-1", [INTERRUPTED]], ["batch-2", [retry]],
    ]));
    const result = await loadCreditBatchTodos(ORG_CTX, "facility", BATCHES);
    expect(getRemovalIdsWithChangedLatestAttempt).toHaveBeenCalledExactlyOnceWith(ORG_CTX, [INTERRUPTED.id, retry.id]);
    expect(result.get("batch-1")?.check[0]?.title).toBe("RM-26-003: Changed since review");
    expect(result.get("batch-2")?.check[0]?.title).toBe("RM-26-004: Submission interrupted");
    expect(getDeletionLeasedRemovalIds).toHaveBeenCalledExactlyOnceWith(ORG_CTX, [INTERRUPTED.id]);
  });

  it.each(["admin", "member"] as const)("shows a fresh deletion lease to a %s across batches", async (orgRole) => {
    const ctx = { ...ORG_CTX, orgRole, isPlatformAdmin: false };
    vi.mocked(getDeletionLeasedRemovalIds).mockResolvedValue(new Set([INTERRUPTED.id]));
    const result = await loadCreditBatchTodos(ctx, "facility", BATCHES);
    expect(getDeletionLeasedRemovalIds).toHaveBeenCalledExactlyOnceWith(ctx, [INTERRUPTED.id]);
    for (const todos of result.values()) {
      expect(todos.check[0]).toMatchObject({
        title: "RM-26-003: Changed since review",
        instruction: "This Removal is being deleted. Reload the page to see the result.",
      });
    }
  });

  it.each(["later failure superseding changed", "no attempt summary"])("keeps the retry item with %s", async () => {
    vi.mocked(getRemovalIdsWithChangedLatestAttempt).mockResolvedValue(new Set());
    const result = await loadCreditBatchTodos(ORG_CTX, "facility", BATCHES);
    expect(getDeletionLeasedRemovalIds).toHaveBeenCalledExactlyOnceWith(ORG_CTX, []);
    expect(hasFinalizedSubmission).not.toHaveBeenCalled();
    expect(result.get("batch-1")?.check[0]).toMatchObject({
      title: "RM-26-003: Submission interrupted",
      instruction: "Open the Removal and finish Review & submit.",
    });
  });

  it("passes no ids to the attempt lookup for other Removal states", async () => {
    vi.mocked(loadCreditBatchRemovalDisplays).mockResolvedValue(new Map([["batch-1", [
      { ...INTERRUPTED, status: { ...INTERRUPTED.status, kind: "submitted" } },
    ]]]));
    const result = await loadCreditBatchTodos(ORG_CTX, "facility", BATCHES);
    expect(getRemovalIdsWithChangedLatestAttempt).toHaveBeenCalledExactlyOnceWith(ORG_CTX, []);
    expect(hasFinalizedSubmission).not.toHaveBeenCalled();
    expect(result.get("batch-1")?.check).toEqual([]);
  });
});
