import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

vi.mock("@/data-access/certification", () => ({
  retireStaleSubmissionDraft: vi.fn(),
}));
vi.mock("@/data-access/certifier-removals", () => ({
  listProductionClaimDraftContenders: vi.fn(),
}));
vi.mock("@/lib/certification/certify-context-core", () => ({
  resolveScopeForRemoval: vi.fn(),
}));

import { retireStaleSubmissionDraft } from "@/data-access/certification";
import {
  assertResumedSnapshotRevisionCurrent,
  retireClaimedRemovalDraftForDrift,
  SUBMITTED_REMOVAL_REVISION_DRIFT_MESSAGE,
} from "./production-claim-gate";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { INTERRUPTED_REMOVAL_CHANGED_MESSAGE } from "@/lib/certification/interrupted-removal-copy";

const ORG_CTX = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "admin",
  isPlatformAdmin: false,
} as OrgContext;

function retire(preserveForReconciliation: boolean) {
  return retireClaimedRemovalDraftForDrift({
    orgCtx: ORG_CTX,
    submissionId: "sub-1",
    reason: "semantic payload drift",
    preserveForReconciliation,
  });
}

describe("retireClaimedRemovalDraftForDrift", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps a draft that may have reached Isometric and points the operator to Delete Removal", async () => {
    await expect(retire(true)).rejects.toThrow(INTERRUPTED_REMOVAL_CHANGED_MESSAGE);
    expect(INTERRUPTED_REMOVAL_CHANGED_MESSAGE).toContain("Select Delete Removal");
    expect(INTERRUPTED_REMOVAL_CHANGED_MESSAGE).not.toMatch(/support/i);
    expect(retireStaleSubmissionDraft).not.toHaveBeenCalled();
  });

  it("retires a mutation-free draft so the next submit rebuilds from current data", async () => {
    await retire(false);
    expect(retireStaleSubmissionDraft).toHaveBeenCalledWith(ORG_CTX, "sub-1", {
      reason: "semantic payload drift",
    });
  });

  it("keeps the support route when an already submitted Removal's settings changed", async () => {
    const row = { id: "sub-1", payloadSnapshot: { __mappingRevision: "old" } } as unknown as CertificationSubmissionRow;
    await expect(assertResumedSnapshotRevisionCurrent(ORG_CTX, row, true, true))
      .rejects.toThrow(SUBMITTED_REMOVAL_REVISION_DRIFT_MESSAGE);
    expect(retireStaleSubmissionDraft).not.toHaveBeenCalled();
  });
});
