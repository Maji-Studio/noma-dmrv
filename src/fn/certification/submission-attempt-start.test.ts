import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMetadataValue } from "@/lib/certification/submission-metadata";
import {
  REMOVAL_ID, USER_ID, makeContext, storedRows, fakeExternalIds,
  isometricClientFake,
} from "../../../tests/fixtures/submit-removal-orchestrator";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { getProductionBatchRegistryInputs } from "@/data-access/certifier-production-batches";
import { SafeError } from "@/lib/errors";
import * as claims from "@/data-access/certification-submissions";
import * as reservations from "@/data-access/production-claim-reservations";
import { loadRemovalSubmissionContext } from "@/lib/certification/certify-context-core";
import * as freshness from "./removal-submission-freshness";
import { submitRemoval } from "./submit-removal";
import { createDatapoint, createGhgEntry, IsometricApiError } from "@/lib/isometric";

vi.mock("./removal-submission-freshness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./removal-submission-freshness")>();
  return { ...actual, assertClaimedRemovalPayloadFresh: vi.fn(actual.assertClaimedRemovalPayloadFresh) };
});
vi.mock("@/lib/isometric/source-binding-verification", () => ({
  verifyRemovalSourceBindings: vi.fn(async () => ({ state: "verified", verifiedCount: 1, totalCount: 1, mismatches: [] })),
}));

const orgCtx = makeTestOrgContext(USER_ID);
const submit = () => submitRemoval({ orgCtx, removalId: REMOVAL_ID });

beforeEach(() => {
  vi.mocked(loadRemovalSubmissionContext).mockImplementation(async () => makeContext());
  vi.mocked(createDatapoint).mockImplementation(fakeExternalIds("dp") as never);
  vi.mocked(createGhgEntry).mockImplementation(fakeExternalIds("rmv") as never);
});

describe("Removal pre-write crash marker", () => {
  it("persists possible before the first registry POST and clears it on success", async () => {
    isometricClientFake.post.mockImplementationOnce(async (_path, body) => {
      expect(storedRows[0].metadata).toMatchObject({ externalMutation: "possible" });
      expect(getMetadataValue(storedRows[0].metadata, "lastAttemptOutcome")).toBeNull();
      return { id: "ptb-first", ...body };
    });
    await submit();
    expect(isometricClientFake.post).toHaveBeenCalled();
    expect(storedRows[0].status).toBe("submitted");
    expect(getMetadataValue(storedRows[0].metadata, "externalMutation")).toBeNull();
  });

  it("retains possible when the first POST and failure recorder fail; the next claim preserves reconciliation", async () => {
    isometricClientFake.post.mockImplementationOnce(async () => {
      expect(getMetadataValue(storedRows[0].metadata, "externalMutation")).toBe("possible");
      throw new Error("connection lost after commit");
    });
    vi.mocked(claims.markSubmissionInterrupted).mockRejectedValueOnce(new Error("process stopped"));
    await expect(submit()).rejects.toThrow();
    const row = storedRows[0];
    expect(row.status).toBe("draft");
    expect(getMetadataValue(row.metadata, "externalMutation")).toBe("possible");
    expect(getMetadataValue(row.metadata, "lastAttemptOutcome")).toBeNull();
    row.lockedAt = new Date(0);
    vi.mocked(freshness.assertClaimedRemovalPayloadFresh).mockClear();
    await submit();
    expect(freshness.assertClaimedRemovalPayloadFresh).toHaveBeenCalledWith(
      expect.objectContaining({ preserveForReconciliation: true, row: expect.objectContaining({ id: row.id }) }),
    );
    expect(storedRows).toHaveLength(1);
    expect(row.version).toBe(1);
  });

  it("rejects a definitive first-POST refusal without a stale marker and requests claim release", async () => {
    isometricClientFake.post.mockRejectedValueOnce(
      new IsometricApiError("refused", 422, undefined, "http"),
    );
    await expect(submit()).rejects.toThrow();
    expect(storedRows[0]).toMatchObject({ status: "rejected", lockedAt: null });
    expect(getMetadataValue(storedRows[0].metadata, "externalMutation")).toBeNull();
    expect(reservations.rejectSubmissionAndReleaseProductionClaims).toHaveBeenCalledWith(orgCtx,
      expect.objectContaining({ submissionId: storedRows[0].id, mutationFreeAttempt: true }));
  });

  it("clears the marker when preparation fails before the first POST", async () => {
    // The precheck reads production inputs before the claim; fail only the
    // read that follows the persisted marker, while nothing has been POSTed.
    const markStarted = vi.mocked(claims.markSubmissionAttemptStarted);
    const markImpl = markStarted.getMockImplementation()!;
    markStarted.mockImplementationOnce(async (...args) => {
      const marked = await markImpl(...args);
      expect(getMetadataValue(storedRows[0].metadata, "externalMutation")).toBe("possible");
      vi.mocked(getProductionBatchRegistryInputs).mockRejectedValueOnce(new SafeError("Preparation failed"));
      return marked;
    });
    await expect(submit()).rejects.toThrow("Preparation failed");
    expect(storedRows[0].status).toBe("rejected");
    expect(getMetadataValue(storedRows[0].metadata, "externalMutation")).toBeNull();
    expect(isometricClientFake.post).not.toHaveBeenCalled();
  });

  it("stops before registry writes if the attempt marker loses its lock", async () => {
    vi.mocked(claims.markSubmissionAttemptStarted).mockImplementationOnce(async () => {
      storedRows[0].lockedAt = new Date(0);
      return false;
    });
    await expect(submit()).rejects.toThrow("submission lock changed");
    expect(isometricClientFake.post).not.toHaveBeenCalled();
    expect(createDatapoint).not.toHaveBeenCalled();
    expect(createGhgEntry).not.toHaveBeenCalled();
    expect(storedRows[0].status).toBe("draft");
  });
});
