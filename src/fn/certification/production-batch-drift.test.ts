import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { MASS_COMPARISON_EPSILON_KG } from "@/lib/calculations/mass-dry";
import { SafeError } from "@/lib/errors";
import type { IsometricProductionBatch } from "@/lib/isometric/production-batches";
import type { Logger } from "@/lib/log";
import type { ProductionBatchSubmission } from "./production-batches";

const mocks = vi.hoisted(() => ({
  appendSyncEventBestEffort: vi.fn(),
  markSubmissionRejected: vi.fn(),
}));
vi.mock("./shared", () => ({
  ...mocks,
  ISOMETRIC_PROVIDER: "isometric",
  REMOVAL_ENTITY_TYPE: "removal",
}));
vi.mock("@/data-access/certification", () => ({
  markSubmissionRejected: mocks.markSubmissionRejected,
}));

import { assertRegisteredProductionBatchMatches } from "./production-batch-drift";

const orgCtx: OrgContext = {
  organizationId: "org-1", userId: "user-1", orgRole: "admin", isPlatformAdmin: false,
};
const log = { warn: vi.fn() } as unknown as Logger;

function fixture() {
  const submission: ProductionBatchSubmission = {
    creditBatchId: "batch-1", creditBatchCode: "NM-001", supplierRefId: "nm-ptb-1",
    massKg: 1_150, startedOn: "2026-03-01", endedOn: "2026-03-28", payloadHash: "current",
    body: {
      supplier_reference_id: "nm-ptb-1", display_name: "NM-001", kind: "biochar",
      facility_id: "fcl_current", feedstock_type_ids: ["ftt_1", "ftt_2"],
      mass: { magnitude: 1_150, unit: "kg" },
      started_at: "2026-03-01T07:15:00.000Z", ended_at: "2026-03-28T18:45:00.000Z",
    },
  };
  const remote: IsometricProductionBatch = {
    ...submission.body, display_name: "NM-001", mass: { ...submission.body.mass }, id: "ptb_1", uploaded_at: "2026-03-29T00:00:00.000Z",
  };
  return {
    orgCtx, removalId: "removal-1", submissionRowId: "submission-1", log,
    expectedLockedAt: new Date("2026-03-30T00:00:00.000Z"),
    legacyWindow: { startDate: "2026-03-01", endDate: "2026-03-28" },
    submission, remote,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.appendSyncEventBestEffort.mockResolvedValue(undefined);
  mocks.markSubmissionRejected.mockResolvedValue(undefined);
});

describe("assertRegisteredProductionBatchMatches", () => {
  it("lists every differing figure and records the exact message before refusal", async () => {
    const args = fixture();
    Object.assign(args.remote, {
      facility_id: "fcl_registered", feedstock_type_ids: ["ftt_registered"], kind: "other",
      mass: { magnitude: 1_200, unit: "kilogram" },
      started_at: "2026-03-01T06:15:00.000Z", ended_at: "2026-03-28T19:45:00.000Z",
    });
    const error = await assertRegisteredProductionBatchMatches(args).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SafeError);
    const message = (error as SafeError).message;
    expect(message).toBe(
      "Credit batch NM-001 is already registered in Isometric with different figures than noma has now. " +
      "Facility mapping changed: Isometric fcl_registered, noma fcl_current. " +
      "Feedstock types: Isometric ftt_registered, noma ftt_1, ftt_2. " +
      "Kind: Isometric other, noma biochar. " +
      "Dry mass: Isometric 1,200 kg, noma 1,150 kg. " +
      "Production window start: Isometric 2026-03-01 06:15:00.000 +00:00, noma 2026-03-01 07:15:00.000 +00:00. " +
      "Production window end: Isometric 2026-03-28 19:45:00.000 +00:00, noma 2026-03-28 18:45:00.000 +00:00. " +
      "Check the production runs in this credit batch for edits made after the first submission. " +
      "To fix it before finalization, delete this Removal, which also removes the records noma created in Isometric. " +
      "Then submit again. Nothing is changed in Isometric automatically.",
    );
    expect(mocks.appendSyncEventBestEffort).toHaveBeenCalledWith(orgCtx, {
      provider: "isometric", entityType: "removal", entityId: "removal-1",
      operation: "production-batch:drift:batch-1", status: "failed", errorMessage: message,
      requestPayload: args.submission.body, responsePayload: { ...args.remote, reused: false },
    }, { submissionId: "submission-1" });
    expect(mocks.markSubmissionRejected).toHaveBeenCalledWith(orgCtx, "submission-1", {
      errorMessage: message, expectedLockedAt: args.expectedLockedAt,
    });
    expect(mocks.appendSyncEventBestEffort.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.markSubmissionRejected.mock.invocationCallOrder[0]);
  });

  it("awaits the sync event before throwing", async () => {
    const args = fixture();
    args.remote.mass.magnitude = 1_200;
    let completeAudit!: () => void;
    mocks.appendSyncEventBestEffort.mockReturnValue(new Promise<void>((resolve) => { completeAudit = resolve; }));
    const pending = assertRegisteredProductionBatchMatches(args);
    expect(mocks.appendSyncEventBestEffort).toHaveBeenCalledOnce();
    expect(mocks.markSubmissionRejected).not.toHaveBeenCalled();
    const refused = expect(pending).rejects.toBeInstanceOf(SafeError);
    completeAudit();
    await refused;
  });

  it("defers rejection to the owning attempt", async () => {
    const args = fixture();
    args.remote.mass = { magnitude: 1_200, unit: "kg" };
    await expect(assertRegisteredProductionBatchMatches({ ...args, deferRejectionToAttempt: true }))
      .rejects.toBeInstanceOf(SafeError);
    expect(mocks.markSubmissionRejected).not.toHaveBeenCalled();
    expect(mocks.appendSyncEventBestEffort).toHaveBeenCalledWith(orgCtx,
      expect.objectContaining({ status: "failed" }), { submissionId: "submission-1" });
  });

  it("preserves the drift error when rejecting the submission fails", async () => {
    const args = fixture();
    args.remote.mass = { magnitude: 1_200, unit: "kg" };
    mocks.markSubmissionRejected.mockRejectedValue(new Error("write unavailable"));
    await expect(assertRegisteredProductionBatchMatches(args)).rejects.toThrow(/Dry mass: Isometric 1,200 kg, noma 1,150 kg/);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ submissionId: "submission-1" }),
      "failed to reject registry submission draft");
  });

  it("reuses matching figures with unit, precision, instant and feedstock-order differences", async () => {
    const args = fixture();
    args.remote = {
      ...args.remote, display_name: "previous name", feedstock_type_ids: ["ftt_2", "ftt_1"],
      mass: { magnitude: 1_150 + MASS_COMPARISON_EPSILON_KG, unit: "kilogram" },
      started_at: "2026-03-01T02:15:00-05:00", ended_at: "2026-03-28T19:45:00+01:00",
    };
    await expect(assertRegisteredProductionBatchMatches(args)).resolves.toBeUndefined();
    expect(mocks.markSubmissionRejected).not.toHaveBeenCalled();
    expect(mocks.appendSyncEventBestEffort).toHaveBeenCalledWith(orgCtx,
      expect.objectContaining({ status: "succeeded", responsePayload: expect.objectContaining({ reused: true }) }),
      { submissionId: "submission-1" });
  });

  it("keeps compatible remote legacy day bounds", async () => {
    const args = fixture();
    args.remote.started_at = "2026-03-01T00:00:00.000Z";
    args.remote.ended_at = "2026-03-28T23:59:59.999Z";
    await expect(assertRegisteredProductionBatchMatches(args)).resolves.toBeUndefined();
  });

  it.each([
    { magnitude: 1_150.001_001, unit: "kg" },
    { magnitude: 1_150, unit: "gram" },
  ])("refuses mass outside the shared tolerance or in another unit: %j", async (mass) => {
    const args = fixture();
    args.remote.mass = mass;
    await expect(assertRegisteredProductionBatchMatches(args)).rejects.toThrow(/Dry mass:/);
  });
});
