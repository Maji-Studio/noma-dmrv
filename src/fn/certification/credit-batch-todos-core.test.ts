import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalDisplay } from "@/data-access/credit-batch-removal-display";
import type { CertifierSyncEventRow } from "@/data-access/certification";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("@/data-access/credit-batch-removal-display", () => ({ loadCreditBatchRemovalDisplays: vi.fn() }));
vi.mock("@/data-access/certifier-sync-events", () => ({ listRemovalAttemptEvents: vi.fn() }));
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
import { listRemovalAttemptEvents } from "@/data-access/certifier-sync-events";
import { hasFinalizedSubmission } from "@/data-access/certification-submissions";
import { getDeletionLeasedRemovalIds } from "@/data-access/removal-deletion-lease";
import { ATTEMPT_SUMMARY_OPERATION } from "@/lib/certification/submission-attempts";
import { ASK_ADMIN_TO_DELETE, FINALIZED_NO_DELETE, OPEN_REMOVAL_TO_DELETE } from "@/lib/certification/interrupted-removal-copy";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/certification/shared";
import { loadCreditBatchTodos } from "./credit-batch-todos-core";

const ORG_CTX = makeTestOrgContext();
const BATCHES = ["batch-1", "batch-2"].map((id) => ({ id, removalTemplateId: null }));
const INTERRUPTED: RemovalDisplay = {
  id: "removal-1", code: "RM-26-003", phase: "draft",
  status: { kind: "interrupted", label: "Submission interrupted", value: "failed", isActionable: true, isTerminal: false },
};

function summary(id: string, at: string, failureKind: string): CertifierSyncEventRow {
  return {
    id, operation: ATTEMPT_SUMMARY_OPERATION, status: "failed", attemptedAt: new Date(at), createdAt: new Date(at),
    errorMessage: null, responsePayload: { failure_kind: failureKind },
  } as CertifierSyncEventRow;
}
const CHANGED = summary("changed", "2026-11-01T12:00:00Z", "changed_since_review");
const LATER_FAILURE = summary("later", "2026-11-02T12:00:00Z", "other");

describe("loadCreditBatchTodos interrupted attempt outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCreditBatchRemovalDisplays).mockResolvedValue(new Map(BATCHES.map(({ id }) => [id, [INTERRUPTED]])));
    vi.mocked(listRemovalAttemptEvents).mockResolvedValue([CHANGED]);
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
    expect(listRemovalAttemptEvents).toHaveBeenCalledExactlyOnceWith(ORG_CTX, { removalId: INTERRUPTED.id });
    expect(getDeletionLeasedRemovalIds).toHaveBeenCalledExactlyOnceWith(ORG_CTX, [INTERRUPTED.id]);
    for (const todos of result.values()) {
      expect(todos.removalInterrupted).toBe(true);
      expect(todos.check[0]).toMatchObject({
        title: "RM-26-003: Changed since review",
        target: { href: "/removals?facility=facility&removal=removal-1" },
      });
    }
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

  it.each([{ events: [CHANGED, LATER_FAILURE] }, { events: [] }])("keeps the retry item without a latest changed outcome: %j", async ({ events }) => {
    vi.mocked(listRemovalAttemptEvents).mockResolvedValue(events);
    const result = await loadCreditBatchTodos(ORG_CTX, "facility", BATCHES);
    expect(getDeletionLeasedRemovalIds).toHaveBeenCalledExactlyOnceWith(ORG_CTX, []);
    expect(hasFinalizedSubmission).not.toHaveBeenCalled();
    expect(result.get("batch-1")?.check[0]).toMatchObject({
      title: "RM-26-003: Submission interrupted",
      instruction: "Open the Removal and finish Review & submit.",
    });
  });

  it("does not fetch attempts for other Removal states", async () => {
    vi.mocked(loadCreditBatchRemovalDisplays).mockResolvedValue(new Map([["batch-1", [
      { ...INTERRUPTED, status: { ...INTERRUPTED.status, kind: "submitted" } },
    ]]]));
    const result = await loadCreditBatchTodos(ORG_CTX, "facility", BATCHES);
    expect(listRemovalAttemptEvents).not.toHaveBeenCalled();
    expect(hasFinalizedSubmission).not.toHaveBeenCalled();
    expect(result.get("batch-1")?.check).toEqual([]);
  });
});
