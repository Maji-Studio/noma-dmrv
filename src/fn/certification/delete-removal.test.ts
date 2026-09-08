import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import type { RemovalDeletionClaim } from "@/data-access/certifier-removal-deletion";

/**
 * Orchestration order for a Removal deletion with registry history: the GHG
 * Entry is deleted before its Biochar Applications, a 404 counts as already
 * gone, and any other refusal releases the claim without local cleanup.
 */

const state = vi.hoisted(() => ({
  claim: vi.fn(),
  finalize: vi.fn(),
  release: vi.fn(),
  deleteGhgEntry: vi.fn(),
  deleteBiocharApplication: vi.fn(),
  findBiocharApplicationBySupplierReference: vi.fn(),
  reconcileRemoval: vi.fn(),
  appendSyncEvent: vi.fn(),
}));

vi.mock("../with-action", () => ({
  withAction: async (run: (ctx: OrgContext) => Promise<unknown>) => ({
    success: true,
    data: await run(ORG_CTX),
  }),
}));
vi.mock("@/data-access/utils", () => ({
  requireOrgFacility: vi.fn(async () => undefined),
}));
vi.mock("@/data-access/certifier-removal-deletion", () => ({
  claimRemovalDeletion: state.claim,
  finalizeRemovalDeletion: state.finalize,
  releaseRemovalDeletionClaim: state.release,
}));
vi.mock("@/lib/isometric", () => ({
  deleteGhgEntry: state.deleteGhgEntry,
  deleteBiocharApplication: state.deleteBiocharApplication,
  findBiocharApplicationBySupplierReference:
    state.findBiocharApplicationBySupplierReference,
  reconcileRemoval: state.reconcileRemoval,
}));
vi.mock("@/lib/isometric/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/isometric/client")>()),
  getIsometricClientForOrg: vi.fn(async () => ({ fake: true })),
}));
vi.mock("./shared", () => ({
  appendSyncEventBestEffort: state.appendSyncEvent,
}));

import { IsometricApiError } from "@/lib/isometric/client";
import { SafeError } from "@/lib/errors";
import { deleteRemoval } from "./delete-removal";

const ORG_CTX: OrgContext = {
  userId: "user-1",
  organizationId: "org-1",
  orgRole: "admin",
  isPlatformAdmin: false,
};
const INPUT = { facilityId: "facility-1", removalId: "removal-1" };

function claim(overrides: Partial<RemovalDeletionClaim> = {}): RemovalDeletionClaim {
  return {
    removalId: INPUT.removalId,
    facilityId: INPUT.facilityId,
    submissionIds: ["sub-1"],
    lockedSubmission: {
      id: "sub-1",
      lockedAt: new Date("2026-09-08T00:00:00Z"),
      priorAttemptOutcome: "interrupted",
    },
    externalRemovalIds: ["gge_1"],
    unconfirmedRemovalSupplierRefs: [],
    biocharApplications: [
      {
        registrationId: "reg-1",
        externalApplicationId: "bse_1",
        supplierReference: "ref-1",
      },
      {
        registrationId: "reg-2",
        externalApplicationId: "bse_2",
        supplierReference: "ref-2",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(state)) mock.mockReset();
  state.finalize.mockResolvedValue({ releasedSliceCount: 2 });
  state.deleteGhgEntry.mockResolvedValue(undefined);
  state.deleteBiocharApplication.mockResolvedValue(undefined);
  state.findBiocharApplicationBySupplierReference.mockResolvedValue(null);
  state.reconcileRemoval.mockResolvedValue({ found: false });
  state.appendSyncEvent.mockResolvedValue(undefined);
});

describe("deleteRemoval", () => {
  it("deletes the GHG Entry before the Biochar Applications, then finalizes", async () => {
    state.claim.mockResolvedValue(claim());
    const order: string[] = [];
    state.deleteGhgEntry.mockImplementation(async (_c, id: string) => {
      order.push(id);
    });
    state.deleteBiocharApplication.mockImplementation(
      async (_c, id: string) => {
        order.push(id);
      },
    );

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(order).toEqual(["gge_1", "bse_1", "bse_2"]);
    expect(result).toEqual({
      removalId: "removal-1",
      deletedGhgEntryIds: ["gge_1"],
      deletedBiocharApplicationIds: ["bse_1", "bse_2"],
      releasedSliceCount: 2,
    });
    expect(state.finalize).toHaveBeenCalledWith(ORG_CTX, claim(), {
      deletedGhgEntryIds: ["gge_1"],
      deletedBiocharApplicationIds: ["bse_1", "bse_2"],
    });
    expect(state.release).not.toHaveBeenCalled();
  });

  it("counts a 404 as already gone and keeps going", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteBiocharApplication.mockImplementationOnce(async () => {
      throw new IsometricApiError("gone", 404, null, "http");
    });

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(result.deletedBiocharApplicationIds).toEqual(["bse_2"]);
    expect(state.finalize).toHaveBeenCalledOnce();
  });

  it("releases the claim and skips local cleanup when the registry refuses", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteGhgEntry.mockRejectedValue(
      new IsometricApiError(
        "refused",
        422,
        { errors: [{ detail: "GHG entry is not in DRAFT status" }] },
        "http",
      ),
    );

    const attempt = deleteRemoval(ORG_CTX, INPUT);
    await expect(attempt).rejects.toBeInstanceOf(SafeError);
    await expect(attempt).rejects.toThrow(
      /GHG Entry gge_1.*not in DRAFT status.*Nothing was removed locally/,
    );

    expect(state.release).toHaveBeenCalledWith(ORG_CTX, claim());
    expect(state.finalize).not.toHaveBeenCalled();
    expect(state.deleteBiocharApplication).not.toHaveBeenCalled();
  });

  it("does not blame DRAFT status for a server-side failure", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteGhgEntry.mockRejectedValue(
      new IsometricApiError("upstream", 502, null, "http"),
    );

    const attempt = deleteRemoval(ORG_CTX, INPUT);
    await expect(attempt).rejects.toThrow(/Try again/);
    await expect(attempt).rejects.not.toThrow(/Only draft registry records/);
  });

  it("releases the claim and names the partial cleanup when a later delete fails", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteBiocharApplication.mockImplementationOnce(async () => {
      throw new IsometricApiError("refused", 409, null, "http");
    });

    const attempt = deleteRemoval(ORG_CTX, INPUT);
    await expect(attempt).rejects.toBeInstanceOf(SafeError);
    await expect(attempt).rejects.toThrow(
      /Biochar Application bse_1.*Run Delete Removal again/,
    );
    expect(state.deleteGhgEntry).toHaveBeenCalledOnce();
    expect(state.release).toHaveBeenCalledWith(ORG_CTX, claim());
    expect(state.finalize).not.toHaveBeenCalled();

    // The retry converges: the GHG Entry is now absent and the rest proceeds.
    state.release.mockClear();
    state.deleteGhgEntry.mockRejectedValueOnce(
      new IsometricApiError("gone", 404, null, "http"),
    );
    const result = await deleteRemoval(ORG_CTX, INPUT);
    expect(result.deletedGhgEntryIds).toEqual([]);
    expect(result.deletedBiocharApplicationIds).toEqual(["bse_1", "bse_2"]);
    expect(state.release).not.toHaveBeenCalled();
    expect(state.finalize).toHaveBeenCalledOnce();
  });

  it("releases the claim when local finalization refuses", async () => {
    state.claim.mockResolvedValue(claim());
    state.finalize.mockRejectedValue(new SafeError("changed"));

    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow(/changed/);
    expect(state.release).toHaveBeenCalledWith(ORG_CTX, claim());
  });

  it("reconciles a GHG Entry whose POST landed without a recorded ID", async () => {
    state.claim.mockResolvedValue(
      claim({
        externalRemovalIds: [],
        unconfirmedRemovalSupplierRefs: ["nm-rmv-abc-removal-v1"],
        biocharApplications: [],
      }),
    );
    state.reconcileRemoval.mockResolvedValue({
      found: true,
      externalId: "gge_recovered",
    });

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(state.reconcileRemoval).toHaveBeenCalledWith(
      { fake: true },
      { supplierRefId: "nm-rmv-abc-removal-v1" },
    );
    expect(state.deleteGhgEntry).toHaveBeenCalledWith({ fake: true }, "gge_recovered");
    expect(result.deletedGhgEntryIds).toEqual(["gge_recovered"]);
  });

  it("skips the registry entirely when the claim carries no external records", async () => {
    state.claim.mockResolvedValue(
      claim({
        externalRemovalIds: [],
        unconfirmedRemovalSupplierRefs: [],
        biocharApplications: [],
        submissionIds: [],
        lockedSubmission: null,
      }),
    );

    await deleteRemoval(ORG_CTX, INPUT);

    expect(state.deleteGhgEntry).not.toHaveBeenCalled();
    expect(state.deleteBiocharApplication).not.toHaveBeenCalled();
    expect(state.finalize).toHaveBeenCalledOnce();
  });

  it("resolves an unconfirmed registration by supplier reference before deleting it", async () => {
    state.claim.mockResolvedValue(
      claim({
        biocharApplications: [
          {
            registrationId: "reg-3",
            externalApplicationId: null,
            supplierReference: "ref-3",
          },
        ],
      }),
    );
    state.findBiocharApplicationBySupplierReference.mockResolvedValue({
      id: "bse_3",
    });

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(state.findBiocharApplicationBySupplierReference).toHaveBeenCalledWith(
      { fake: true },
      "ref-3",
    );
    expect(state.deleteBiocharApplication).toHaveBeenCalledWith(
      { fake: true },
      "bse_3",
    );
    expect(result.deletedBiocharApplicationIds).toEqual(["bse_3"]);
  });

  it("skips an unconfirmed registration the registry never received", async () => {
    state.claim.mockResolvedValue(
      claim({
        biocharApplications: [
          {
            registrationId: "reg-3",
            externalApplicationId: null,
            supplierReference: "ref-3",
          },
        ],
      }),
    );

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(state.deleteBiocharApplication).not.toHaveBeenCalled();
    expect(result.deletedBiocharApplicationIds).toEqual([]);
    expect(state.finalize).toHaveBeenCalledOnce();
  });

});
