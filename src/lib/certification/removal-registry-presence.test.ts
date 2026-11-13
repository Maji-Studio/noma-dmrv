import { describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/log";
import { IsometricApiError } from "@/lib/isometric/client";
import { buildBiocharApplicationReference } from "@/lib/isometric/biochar-applications";
import { decideSubmissionClaim, REMOVAL_SUBMISSION_CLAIM_POLICY } from "@/lib/isometric/utils/submission-claim";
import { isSentRemoval, recordLocks } from "@/lib/record-lock";
import { isRegistryMissingSubmission, readRemovalRegistryPresence } from "./removal-registry-presence";

const missing = { id: "v1", status: "superseded" as const, externalId: "rmv_old", version: 1,
  payloadHash: "same", lockedAt: null, submittedAt: "2026-11-01T00:00:00Z",
  metadata: { registryMissingExternalId: "rmv_old", registryMissingConfirmedAt: "2026-11-13T00:00:00Z" } };

describe("missing Removal recovery", () => {
  it.each([401, 403, 429, 500])("treats HTTP %s as unknown", async status => {
    expect(await readRemovalRegistryPresence(async () => { throw new IsometricApiError("failure", status); }, "rmv_old")).toBe("unknown");
  });
  it("only treats a definitive 404 as missing", async () => {
    expect(await readRemovalRegistryPresence(async () => { throw new IsometricApiError("missing", 404); }, "rmv_old")).toBe("missing");
    expect(await readRemovalRegistryPresence(async () => { throw new IsometricApiError("network", 404, null, "network"); }, "rmv_old")).toBe("unknown");
    expect(await readRemovalRegistryPresence(async () => { throw new Error("timeout"); }, "rmv_old")).toBe("unknown");
    expect(await readRemovalRegistryPresence(async () => ({ id: "rmv_old" }), "rmv_old")).toBe("present");
  });
  it("logs an unknown read with the id and no request body", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    await readRemovalRegistryPresence(async () => { throw new IsometricApiError("failure", 500, { secret: "x" }); }, "rmv_old");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ externalId: "rmv_old" }), "Registry presence read failed");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
  });
  it("recognizes only the confirmed retired identity", () => {
    expect(isRegistryMissingSubmission(missing)).toBe(true);
    expect(isRegistryMissingSubmission({ ...missing, status: "submitted" })).toBe(false);
    expect(isRegistryMissingSubmission({ ...missing, externalId: "other" })).toBe(false);
    expect(isRegistryMissingSubmission({ ...missing, metadata: {} })).toBe(false);
  });
  it("keeps every record Sent before retirement, during resend, and afterwards", () => {
    const versions = [
      [{ ...missing, status: "submitted" }], [missing],
      [missing, { status: "draft", externalId: null }],
      [missing, { status: "submitted", externalId: "rmv_new" }],
    ];
    for (const submissions of versions) {
      const removal = { id: "removal", submissions, statements: [] };
      expect(isSentRemoval(removal)).toBe(true);
      for (const lock of Object.values(recordLocks)) expect(lock({ dependents: [], removals: [removal] }).level).toBe("sent");
    }
  });
  it("creates v2 even with identical values, with distinct Application references", () => {
    expect(decideSubmissionClaim({ latest: missing, payloadHash: "same", now: Date.now(), lockTtlMs: 1,
      policy: REMOVAL_SUBMISSION_CLAIM_POLICY })).toMatchObject({ kind: "create-new-version", nextVersion: 2, reason: "after-superseded" });
    const reference = (version: number) => buildBiocharApplicationReference({ applicationId: "app", creditBatchId: "batch", environment: "sandbox", removalSubmissionVersion: version });
    expect(reference(2)).not.toBe(reference(1));
  });
});
