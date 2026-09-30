import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";

vi.mock("./certify-context-core", () => ({
  loadRemovalSubmissionContext: vi.fn(),
}));
vi.mock("./production-claim-gate", () => ({
  retireClaimedRemovalDraftForDrift: vi.fn(),
}));
vi.mock("./removal-submission-build", () => ({
  buildRemovalSubmissionBuild: vi.fn(),
}));
vi.mock("./removal-submission-prepare", () => ({
  prepareRemovalSubmission: vi.fn(),
}));
vi.mock("@/lib/isometric", () => ({
  payloadHash: (payload: { hash: string }) => payload.hash,
}));

import { loadRemovalSubmissionContext } from "./certify-context-core";
import { retireClaimedRemovalDraftForDrift } from "./production-claim-gate";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { assertClaimedRemovalPayloadFresh } from "./removal-submission-freshness";
import {
  prepareRemovalSubmission,
  type PreparedRemovalSubmission,
} from "./removal-submission-prepare";

const ORG_CTX = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "owner",
  isPlatformAdmin: false,
} as OrgContext;
const ROW = { id: "sub-1", payloadHash: "hash-claimed" } as CertificationSubmissionRow;
const PREPARED = { externalProjectId: "prj-1" } as PreparedRemovalSubmission;

function assertFresh() {
  return assertClaimedRemovalPayloadFresh({
    orgCtx: ORG_CTX,
    removalId: "rem-1",
    row: ROW,
    preserveForReconciliation: false,
  });
}

function retiredReason() {
  return vi.mocked(retireClaimedRemovalDraftForDrift).mock.calls[0]?.[0].reason;
}

describe("assertClaimedRemovalPayloadFresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue({} as never);
  });

  it("passes when the rebuilt payload matches the claimed draft", async () => {
    vi.mocked(prepareRemovalSubmission).mockReturnValue({
      prepared: PREPARED,
      blockers: [],
    });
    vi.mocked(buildRemovalSubmissionBuild).mockResolvedValue({
      semanticPayload: { hash: "hash-claimed" },
    } as never);

    await expect(assertFresh()).resolves.toBeUndefined();
    expect(buildRemovalSubmissionBuild).toHaveBeenCalledWith(
      expect.objectContaining({ prepared: PREPARED }),
    );
    expect(retireClaimedRemovalDraftForDrift).not.toHaveBeenCalled();
  });

  it("retires the draft when the template stopped being a REMOVAL template", async () => {
    vi.mocked(prepareRemovalSubmission).mockReturnValue({
      prepared: PREPARED,
      blockers: [{ code: "notRemovalTemplate", message: "not a removal template" }],
    });

    await expect(assertFresh()).rejects.toThrow(
      /template configuration changed while preparing this submission/,
    );
    expect(retiredReason()).toBe(
      "semantic payload rebuild failed after draft claim",
    );
    expect(buildRemovalSubmissionBuild).not.toHaveBeenCalled();
  });

  it("names the durability gate when it is the only change", async () => {
    vi.mocked(prepareRemovalSubmission).mockReturnValue({
      prepared: PREPARED,
      blockers: [{ code: "durabilityUnavailable", message: "unavailable" }],
    });

    await expect(assertFresh()).rejects.toThrow(
      "Removal template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
    );
    expect(retiredReason()).toBe(
      "durability measurement-sample gate changed after draft claim",
    );
  });

  it("retires the draft and rethrows when the rebuild fails", async () => {
    vi.mocked(prepareRemovalSubmission).mockReturnValue({
      prepared: PREPARED,
      blockers: [],
    });
    vi.mocked(buildRemovalSubmissionBuild).mockRejectedValue(
      new Error("lineage broke"),
    );

    await expect(assertFresh()).rejects.toThrow("lineage broke");
    expect(retiredReason()).toBe(
      "semantic payload rebuild failed after draft claim",
    );
  });

  it("retires the draft when the rebuilt payload drifted", async () => {
    vi.mocked(prepareRemovalSubmission).mockReturnValue({
      prepared: PREPARED,
      blockers: [],
    });
    vi.mocked(buildRemovalSubmissionBuild).mockResolvedValue({
      semanticPayload: { hash: "hash-current" },
    } as never);

    await expect(assertFresh()).rejects.toThrow(
      /Removal source data changed while preparing this submission/,
    );
    expect(retiredReason()).toBe(
      "semantic payload drift: snapshot hash-claimed != current hash-current",
    );
  });
});
