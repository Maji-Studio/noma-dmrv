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
  mutation: vi.fn(),
  mirrorLock: vi.fn(),
  shared: vi.fn(),
  getProductionBatch: vi.fn(),
  findProductionBatch: vi.fn(),
  getMeasurement: vi.fn(),
  findMeasurement: vi.fn(),
  deleteMeasurement: vi.fn(),
  deleteProductionBatch: vi.fn(),
  deleteGhgEntry: vi.fn(),
  deleteBiocharApplication: vi.fn(),
  deleteSource: vi.fn(),
  findBiocharApplicationBySupplierReference: vi.fn(),
  reconcileRemoval: vi.fn(),
  appendSyncEvent: vi.fn(),
}));

vi.mock("@/data-access/removal-production-batch-deletion", () => ({ isRemovalProductionBatchShared: state.shared }));
vi.mock("@/lib/isometric/production-batches", () => ({ deleteProductionBatch: state.deleteProductionBatch, getProductionBatch: state.getProductionBatch, findProductionBatchBySupplierRef: state.findProductionBatch }));
vi.mock("@/lib/isometric/measurement-samples", () => ({ deleteMeasurementSample: state.deleteMeasurement, getMeasurementSample: state.getMeasurement, findMeasurementSampleBySupplierRef: state.findMeasurement }));
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
  withReleasedDocumentMirrorLock: state.mirrorLock,
  withRemovalDeletionMutation: state.mutation,
}));
vi.mock("@/lib/isometric", () => ({
  deleteProductionBatch: state.deleteProductionBatch,
  deleteGhgEntry: state.deleteGhgEntry,
  deleteBiocharApplication: state.deleteBiocharApplication,
  deleteSource: state.deleteSource,
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
    lockedAt: new Date("2026-09-08T00:00:00Z"),
    lockedSubmissions: [
      { id: "sub-1", priorLockedAt: null, priorAttemptOutcome: "interrupted" },
    ],
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
  state.mutation.mockImplementation((_ctx, _claim, run) => run({ guarded: true }));
  state.mirrorLock.mockImplementation((_ctx, _documentId, run) => run());
  state.deleteSource.mockResolvedValue(undefined);
  state.shared.mockResolvedValue(false);
  state.getProductionBatch.mockResolvedValue({ id: "ptb_1", supplier_reference_id: "batch-ref", facility_id: "fcl_1" });
  state.findProductionBatch.mockResolvedValue(null);
  state.findMeasurement.mockResolvedValue(null);
  state.getMeasurement.mockResolvedValue(null);
  state.finalize.mockResolvedValue({
    releasedSliceCount: 2,
    releasedDocumentMirrors: [],
  });
  state.deleteGhgEntry.mockResolvedValue(undefined);
  state.deleteBiocharApplication.mockResolvedValue(undefined);
  state.findBiocharApplicationBySupplierReference.mockResolvedValue(null);
  state.reconcileRemoval.mockResolvedValue({ found: false });
  state.appendSyncEvent.mockResolvedValue(undefined);
});

describe("deleteRemoval", () => {
  it.each([new Error("database connection failed"), new SafeError("The deletion claim changed")])("does not invent a provider attempt for a local fence error", async (error) => {
    state.claim.mockResolvedValue(claim());
    state.mutation.mockRejectedValue(error);
    const deletion = deleteRemoval(ORG_CTX, INPUT);
    await expect(deletion).rejects.toThrow(error instanceof SafeError ? error.message : "could not be removed locally");
    expect(state.deleteGhgEntry).not.toHaveBeenCalled();
    expect(state.appendSyncEvent).not.toHaveBeenCalled();
    expect(state.finalize).not.toHaveBeenCalled();
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("audits a real delete before propagating a subsequent local commit failure", async () => {
    state.claim.mockResolvedValue(claim());
    state.mutation.mockImplementation(async (_ctx, _claim, run) => {
      await run({ guarded: true });
      throw new Error("database commit failed");
    });
    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow("could not be removed locally");
    expect(state.deleteGhgEntry).toHaveBeenCalledOnce();
    expect(state.appendSyncEvent).toHaveBeenCalledOnce();
    expect(state.appendSyncEvent.mock.calls[0][1]).toMatchObject({
      operation: "removal:delete:ghg-entry", status: "succeeded",
      responsePayload: { id: "gge_1", outcome: "deleted" },
    });
    expect(state.finalize).not.toHaveBeenCalled();
  });

  it("audits a generic failure thrown during the actual provider request", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteGhgEntry.mockRejectedValue(new Error("request failed"));
    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow("Isometric did not delete");
    expect(state.appendSyncEvent).toHaveBeenCalledOnce();
    expect(state.appendSyncEvent.mock.calls[0][1]).toMatchObject({ operation: "removal:delete:ghg-entry", status: "failed" });
    expect(state.finalize).not.toHaveBeenCalled();
  });

  it.each(["absent", "retained"] as const)("audits %s artifacts for a Removal without ledger history", async (outcome) => {
    state.claim.mockResolvedValue(claim({ submissionIds: [], lockedSubmissions: [],
      externalRemovalIds: [], biocharApplications: [], productionBatches: [{
        creditBatchId: "batch-1", registrationId: "registration-1",
        externalProductionBatchId: "ptb_1", supplierReference: "batch-ref", externalFacilityId: "fcl_1",
      }] }));
    state.shared.mockResolvedValue(outcome === "retained");
    state.getProductionBatch.mockResolvedValue(null);
    await deleteRemoval(ORG_CTX, INPUT);
    expect(state.appendSyncEvent).toHaveBeenCalledWith(ORG_CTX, expect.objectContaining({
      operation: "removal:delete", responsePayload: expect.objectContaining({
        production_batches: [{ creditBatchId: "batch-1", externalId: "ptb_1", outcome }],
        measurement_samples: [], absent_ghg_entry_ids: [], absent_biochar_application_ids: [],
      }),
    }), { removalId: INPUT.removalId });
  });

  it("deletes an exclusive production batch and finalizes its saved registration", async () => {
    state.claim.mockResolvedValue({ ...claim(), productionBatches: [{
      creditBatchId: "batch-1", registrationId: "registration-1",
      externalProductionBatchId: "ptb_1", supplierReference: "batch-ref",
      externalFacilityId: "fcl_1",
    }] });
    await deleteRemoval(ORG_CTX, INPUT);
    expect(state.deleteProductionBatch).toHaveBeenCalledWith({ fake: true }, "ptb_1");
    expect(state.finalize.mock.calls[0]?.[2]).toMatchObject({
      productionBatches: [expect.objectContaining({ externalId: "ptb_1", outcome: "deleted" })],
    });
  });

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
    expect(state.mutation).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      removalId: "removal-1",
      deletedGhgEntryIds: ["gge_1"],
      deletedBiocharApplicationIds: ["bse_1", "bse_2"],
      releasedSliceCount: 2,
      releasedDocumentMirrorCount: 0,
      deletedSourceIds: [],
    });
    expect(state.finalize).toHaveBeenCalledWith(ORG_CTX, claim(), {
      deletedGhgEntryIds: ["gge_1"],
      deletedBiocharApplicationIds: ["bse_1", "bse_2"],
      absentGhgEntryIds: [],
      absentBiocharApplicationIds: [],
      unresolvedBiocharApplicationReferences: [],
      productionBatches: [],
      measurementSamples: [],
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
    expect(state.finalize.mock.calls[0]?.[2]).toMatchObject({
      absentBiocharApplicationIds: ["bse_1"],
    });
  });

  it("does not blame DRAFT status for an auth or rate-limit refusal", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteGhgEntry.mockRejectedValue(
      new IsometricApiError("forbidden", 403, null, "http"),
    );

    const attempt = deleteRemoval(ORG_CTX, INPUT);
    await expect(attempt).rejects.toThrow(/Try again/);
    await expect(attempt).rejects.not.toThrow(/Only draft registry records/);
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

  it("reports a local database failure as local, not as a registry refusal", async () => {
    state.claim.mockResolvedValue(claim());
    state.finalize.mockRejectedValue(new Error("connection reset"));

    const attempt = deleteRemoval(ORG_CTX, INPUT);
    await expect(attempt).rejects.toBeInstanceOf(SafeError);
    await expect(attempt).rejects.toThrow(/could not be removed locally.*Run Delete Removal again/);
    await expect(attempt).rejects.not.toThrow(/Isometric did not delete/);
    expect(state.release).toHaveBeenCalledWith(ORG_CTX, claim());
  });

  it("records a sanitized registry error body on the failed sync event", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteGhgEntry.mockRejectedValue(
      new IsometricApiError(
        "refused",
        422,
        { errors: [{ detail: "not draft" }], authorization: "Bearer secret" },
        "http",
      ),
    );

    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toBeInstanceOf(SafeError);
    const failed = state.appendSyncEvent.mock.calls.find(
      (call) => call[1]?.status === "failed",
    );
    expect(failed?.[1]?.responsePayload).not.toMatchObject({
      authorization: "Bearer secret",
    });
    expect(JSON.stringify(failed?.[1]?.responsePayload)).not.toContain("secret");
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

  it("deletes the released Sources after finalize, under each document's mirror lock", async () => {
    state.claim.mockResolvedValue(claim({ biocharApplications: [] }));
    const order: string[] = [];
    state.finalize.mockImplementation(async () => {
      order.push("finalize");
      return {
        releasedSliceCount: 1,
        releasedDocumentMirrors: [
          { documentId: "doc-1", externalDocumentId: "src_1" },
          { documentId: "doc-2", externalDocumentId: "src_2" },
        ],
      };
    });
    state.deleteSource.mockImplementation(async (_client, id: string) => {
      order.push(`source:${id}`);
    });

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(order).toEqual(["finalize", "source:src_1", "source:src_2"]);
    expect(state.mirrorLock.mock.calls.map(([, documentId]) => documentId)).toEqual(["doc-1", "doc-2"]);
    expect(result.deletedSourceIds).toEqual(["src_1", "src_2"]);
    expect(result.releasedDocumentMirrorCount).toBe(2);
    expect(state.appendSyncEvent).toHaveBeenCalledWith(
      ORG_CTX,
      expect.objectContaining({
        operation: "removal:delete:source",
        status: "succeeded",
        requestPayload: { id: "src_2" },
        responsePayload: { id: "src_2", outcome: "deleted" },
      }),
      { removalId: INPUT.removalId },
    );
    // The Removal's own success event lands before the best-effort cleanup.
    const operations = state.appendSyncEvent.mock.calls.map(([, event]) => event.operation);
    expect(operations.indexOf("removal:delete")).toBeLessThan(
      operations.indexOf("removal:delete:source"),
    );
  });

  it("audits a Source the fence could not reach as failed without a provider attempt", async () => {
    state.claim.mockResolvedValue(claim({ biocharApplications: [] }));
    state.finalize.mockResolvedValue({
      releasedSliceCount: 0,
      releasedDocumentMirrors: [{ documentId: "doc-1", externalDocumentId: "src_1" }],
    });
    state.mirrorLock.mockRejectedValue(new Error("canceling statement due to lock timeout"));

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(result.deletedSourceIds).toEqual([]);
    expect(state.deleteSource).not.toHaveBeenCalled();
    expect(state.appendSyncEvent).toHaveBeenCalledWith(
      ORG_CTX,
      expect.objectContaining({
        operation: "removal:delete:source",
        status: "failed",
        requestPayload: { id: "src_1" },
        errorMessage: expect.stringMatching(/lock timeout/),
      }),
      { removalId: INPUT.removalId },
    );
  });

  it("keeps a released Source that a concurrent mirror mapped again", async () => {
    state.claim.mockResolvedValue(claim({ biocharApplications: [] }));
    state.finalize.mockResolvedValue({
      releasedSliceCount: 0,
      releasedDocumentMirrors: [{ documentId: "doc-1", externalDocumentId: "src_1" }],
    });
    state.mirrorLock.mockResolvedValue("retained");

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(state.deleteSource).not.toHaveBeenCalled();
    expect(result.deletedSourceIds).toEqual([]);
    expect(state.appendSyncEvent).not.toHaveBeenCalledWith(
      ORG_CTX,
      expect.objectContaining({ operation: "removal:delete:source" }),
      expect.anything(),
    );
  });

  it("finishes the deletion when a released Source cannot be deleted, and audits why", async () => {
    state.claim.mockResolvedValue(claim({ biocharApplications: [] }));
    state.finalize.mockResolvedValue({
      releasedSliceCount: 0,
      releasedDocumentMirrors: [
        { documentId: "doc-1", externalDocumentId: "src_refused" },
        { documentId: "doc-2", externalDocumentId: "src_gone" },
        { documentId: "doc-3", externalDocumentId: "src_ok" },
      ],
    });
    state.deleteSource.mockImplementation(async (_client, id: string) => {
      if (id === "src_refused") {
        throw new IsometricApiError(
          "refused",
          422,
          { errors: [{ detail: "Source is referenced by a locked datapoint" }] },
          "http",
        );
      }
      if (id === "src_gone") throw new IsometricApiError("gone", 404, null, "http");
    });

    const result = await deleteRemoval(ORG_CTX, INPUT);

    expect(result.deletedSourceIds).toEqual(["src_ok"]);
    expect(state.deleteSource).toHaveBeenCalledTimes(3);
    expect(state.release).not.toHaveBeenCalled();
    expect(state.appendSyncEvent).toHaveBeenCalledWith(
      ORG_CTX,
      expect.objectContaining({
        operation: "removal:delete:source",
        status: "failed",
        requestPayload: { id: "src_refused" },
        errorMessage: expect.stringMatching(
          /Source src_refused.*locked datapoint.*Removal was deleted; the Source stays on the registry/,
        ),
      }),
      { removalId: INPUT.removalId },
    );
    expect(state.appendSyncEvent).toHaveBeenCalledWith(
      ORG_CTX,
      expect.objectContaining({
        operation: "removal:delete:source",
        status: "succeeded",
        responsePayload: { id: "src_gone", outcome: "absent" },
      }),
      { removalId: INPUT.removalId },
    );
  });

  it("skips the registry entirely when the claim carries no external records", async () => {
    state.claim.mockResolvedValue(
      claim({
        externalRemovalIds: [],
        unconfirmedRemovalSupplierRefs: [],
        biocharApplications: [],
        submissionIds: [],
        lockedSubmissions: [],
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
    expect(state.finalize.mock.calls[0]?.[2]).toMatchObject({
      unresolvedBiocharApplicationReferences: ["ref-3"],
    });
  });

  it("records a failed sync event when a supplier-reference lookup is refused", async () => {
    state.claim.mockResolvedValue(
      claim({
        externalRemovalIds: [],
        unconfirmedRemovalSupplierRefs: ["nm-rmv-abc-removal-v1"],
        biocharApplications: [],
      }),
    );
    state.reconcileRemoval.mockRejectedValue(
      new SafeError("Multiple GHG Entries use this stable reference"),
    );

    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow(/stable reference/);
    const failed = state.appendSyncEvent.mock.calls.find(
      (call) => call[1]?.status === "failed",
    );
    expect(failed?.[1]).toMatchObject({
      operation: "removal:delete:ghg-entry",
      requestPayload: { supplier_reference_id: "nm-rmv-abc-removal-v1" },
    });
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("still reports the original error when releasing the claim fails", async () => {
    state.claim.mockResolvedValue(claim());
    state.finalize.mockRejectedValue(new SafeError("changed"));
    state.release.mockRejectedValue(new Error("connection reset"));

    const attempt = deleteRemoval(ORG_CTX, INPUT);
    await expect(attempt).rejects.toBeInstanceOf(SafeError);
    await expect(attempt).rejects.toThrow(/changed/);
  });

  it("gives one next action when the cleanup was partial", async () => {
    state.claim.mockResolvedValue(claim());
    state.deleteBiocharApplication.mockImplementationOnce(async () => {
      throw new IsometricApiError("upstream", 502, null, "http");
    });

    const attempt = deleteRemoval(ORG_CTX, INPUT);
    await expect(attempt).rejects.toThrow(/Run Delete Removal again/);
    await expect(attempt).rejects.not.toThrow(/Try again/);
  });

});

const batchTarget = {
  creditBatchId: "batch-1", registrationId: "registration-1",
  externalProductionBatchId: "ptb_1", supplierReference: "batch-ref", externalFacilityId: "fcl_1",
};
const measurementTarget = { submissionId: "sub-1", supplierReference: "measurement-ref", externalId: "mts_1" };

describe("Removal artifact cleanup", () => {
  beforeEach(() => {
    state.claim.mockResolvedValue(claim({ productionBatches: [batchTarget], measurementSamples: [measurementTarget] }));
    state.findMeasurement.mockResolvedValue({ id: "mts_1", supplier_reference_id: "measurement-ref" });
  });

  it.each(["deleted", "absent", "failed"] as const)("audits %s registry calls only after releasing mutation locks", async (result) => {
    let locked = false;
    state.mutation.mockImplementation(async (_ctx, _claim, run) => {
      locked = true;
      try { return await run({ guarded: true }); }
      finally { locked = false; }
    });
    for (const remove of [state.deleteGhgEntry, state.deleteBiocharApplication, state.deleteMeasurement, state.deleteProductionBatch]) {
      remove.mockImplementation(async () => { expect(locked).toBe(true); });
    }
    if (result !== "deleted") state.deleteProductionBatch.mockImplementation(async () => {
      expect(locked).toBe(true);
      throw new IsometricApiError("refused", result === "absent" ? 404 : 500, null, "http");
    });
    state.appendSyncEvent.mockImplementation(async () => { expect(locked).toBe(false); });
    const deletion = deleteRemoval(ORG_CTX, INPUT);
    if (result === "failed") {
      await expect(deletion).rejects.toThrow("did not delete");
      expect(state.finalize).not.toHaveBeenCalled();
    } else await deletion;
    const events = state.appendSyncEvent.mock.calls.filter((call) => call[1].operation === "removal:delete:production-batch");
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject(result === "failed"
      ? { status: "failed" }
      : { status: "succeeded", responsePayload: { outcome: result } });
  });

  it("deletes GHG Entries, applications, owned measurements, then exclusive batches", async () => {
    const order: string[] = [];
    for (const [name, mock] of [["ghg", state.deleteGhgEntry], ["application", state.deleteBiocharApplication],
      ["measurement", state.deleteMeasurement], ["batch", state.deleteProductionBatch], ["finalize", state.finalize]] as const) {
      mock.mockImplementation(async () => {
        order.push(name);
        return { releasedSliceCount: 2, releasedDocumentMirrors: [] };
      });
    }
    await deleteRemoval(ORG_CTX, INPUT);
    expect(order).toEqual(["ghg", "application", "application", "measurement", "batch", "finalize"]);
  });

  it("retains shared batches while deleting only this Removal's measurements", async () => {
    state.shared.mockResolvedValue(true);
    await deleteRemoval(ORG_CTX, INPUT);
    expect(state.deleteMeasurement).toHaveBeenCalledOnce();
    expect(state.deleteProductionBatch).not.toHaveBeenCalled();
    expect(state.getProductionBatch).not.toHaveBeenCalled();
    expect(state.finalize.mock.calls[0][2].productionBatches).toEqual([{ creditBatchId: "batch-1", externalId: "ptb_1", outcome: "retained" }]);
  });

  it("retains a batch that becomes shared during registry readback", async () => {
    state.shared.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await deleteRemoval(ORG_CTX, INPUT);
    expect(state.deleteProductionBatch).not.toHaveBeenCalled();
    expect(state.finalize.mock.calls[0][2].productionBatches[0].outcome).toBe("retained");
    expect(state.appendSyncEvent.mock.calls.some((call) => call[1].operation === "removal:delete:production-batch")).toBe(false);
  });

  it("stops all child cleanup when GHG Entry deletion is refused", async () => {
    state.deleteGhgEntry.mockRejectedValue(new IsometricApiError("refused", 409, null, "http"));
    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow("GHG Entry");
    expect(state.deleteMeasurement).not.toHaveBeenCalled();
    expect(state.deleteProductionBatch).not.toHaveBeenCalled();
    expect(state.finalize).not.toHaveBeenCalled();
  });

  it.each([404, 400])("tolerates exact missing-resource retries (%s)", async (status) => {
    state.deleteMeasurement.mockRejectedValue(new IsometricApiError("gone", status,
      { detail: "Could not find 'MeasurementSample' with IDs 'mts_1'" }, "http"));
    state.deleteProductionBatch.mockRejectedValue(new IsometricApiError("gone", status,
      { detail: "Could not find 'ProductionBatch' with IDs 'ptb_1'" }, "http"));
    await deleteRemoval(ORG_CTX, INPUT);
    expect(state.finalize.mock.calls[0][2]).toMatchObject({
      measurementSamples: [expect.objectContaining({ outcome: "absent" })],
      productionBatches: [expect.objectContaining({ outcome: "absent" })],
    });
  });

  it.each([400, 401, 500])("keeps journals and releases the claim on normal registry refusal (%s)", async (status) => {
    state.deleteProductionBatch.mockRejectedValue(new IsometricApiError("refused", status, { detail: "not deletable" }, "http"));
    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow("Run Delete Removal again");
    expect(state.release).toHaveBeenCalledOnce();
    expect(state.finalize).not.toHaveBeenCalled();
  });

  it("reconciles unjournaled measurement and production batch POSTs", async () => {
    state.claim.mockResolvedValue(claim({ productionBatches: [{ ...batchTarget, registrationId: null, externalProductionBatchId: null }],
      measurementSamples: [{ ...measurementTarget, externalId: null }] }));
    state.findProductionBatch.mockResolvedValue({ id: "ptb_1", facility_id: "fcl_1", supplier_reference_id: "batch-ref" });
    await deleteRemoval(ORG_CTX, INPUT);
    expect(state.findProductionBatch).toHaveBeenCalledWith({ fake: true }, "batch-ref");
    expect(state.findMeasurement).toHaveBeenCalledWith({ fake: true }, "measurement-ref", { requireUnique: true });
    expect(state.deleteProductionBatch).toHaveBeenCalledOnce();
    expect(state.deleteMeasurement).toHaveBeenCalledOnce();
  });

  it("does not delete an unmatched journal ID when supplier lookup is absent", async () => {
    state.findMeasurement.mockResolvedValue(null);
    state.getMeasurement.mockResolvedValue({ id: "mts_1", supplier_reference_id: "another-version" });
    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow("does not match");
    expect(state.deleteMeasurement).not.toHaveBeenCalled();
  });

  it("records confirmed absence without deleting another resource", async () => {
    state.findMeasurement.mockResolvedValue(null);
    state.getProductionBatch.mockResolvedValue(null);
    await deleteRemoval(ORG_CTX, INPUT);
    expect(state.deleteMeasurement).not.toHaveBeenCalled();
    expect(state.deleteProductionBatch).not.toHaveBeenCalled();
    expect(state.finalize.mock.calls[0][2].productionBatches[0].outcome).toBe("absent");
  });

  it.each([
    { id: "ptb_wrong", supplier_reference_id: "batch-ref", facility_id: "fcl_1" },
    { id: "ptb_1", supplier_reference_id: "another-ref", facility_id: "fcl_1" },
    { id: "ptb_1", supplier_reference_id: "batch-ref", facility_id: "another-facility" },
  ])("refuses inconsistent batch identity", async (remote) => {
    state.getProductionBatch.mockResolvedValue(remote);
    await expect(deleteRemoval(ORG_CTX, INPUT)).rejects.toThrow("does not match");
    expect(state.deleteProductionBatch).not.toHaveBeenCalled();
    expect(state.finalize).not.toHaveBeenCalled();
  });
});
