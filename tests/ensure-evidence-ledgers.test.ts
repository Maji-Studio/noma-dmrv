import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";
import type { RemovalSubmissionContext } from "@/fn/certification/certify-context-core";

vi.mock("@/fn/certification/evidence-ledger", () => ({
  ensureTransportEvidenceLedgerSourceFromContext: vi.fn(),
}));
vi.mock("@/fn/certification/durability-evidence-ledger", () => ({
  ensureDurabilityEvidenceLedgerSourceFromContext: vi.fn(),
}));

import { ensureDurabilityEvidenceLedgerSourceFromContext } from "@/fn/certification/durability-evidence-ledger";
import { ensureTransportEvidenceLedgerSourceFromContext } from "@/fn/certification/evidence-ledger";
import { ensureEvidenceLedgersFromContext } from "@/fn/certification/ensure-evidence-ledgers";
import { EvidenceLedgerRetirementError } from "@/fn/certification/evidence-ledger-core";
import { SafeError } from "@/lib/errors";

const orgCtx = makeTestOrgContext("user-1");
const ctx = {} as RemovalSubmissionContext;
const log = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureTransportEvidenceLedgerSourceFromContext).mockResolvedValue({
    status: "skipped",
    reason: "no-legs",
  });
  vi.mocked(ensureDurabilityEvidenceLedgerSourceFromContext).mockResolvedValue({
    status: "skipped",
    reason: "no-samples",
  });
});

describe("ensureEvidenceLedgersFromContext", () => {
  it("fails closed when an inapplicable ledger cannot be retired", async () => {
    const failure = new EvidenceLedgerRetirementError(
      "durability_evidence_ledger",
      new Error("delete failed"),
    );
    vi.mocked(
      ensureDurabilityEvidenceLedgerSourceFromContext,
    ).mockRejectedValue(failure);

    await expect(
      ensureEvidenceLedgersFromContext(orgCtx, "removal-1", ctx, log as never),
    ).rejects.toBe(failure);
    expect(failure).toBeInstanceOf(SafeError);
    expect(failure.message).toBe(
      "Old certification evidence could not be replaced. Retry the submission.",
    );
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("fails closed when ordinary ledger generation fails", async () => {
    const failure = new Error("render failed");
    vi.mocked(
      ensureTransportEvidenceLedgerSourceFromContext,
    ).mockRejectedValue(failure);

    await expect(
      ensureEvidenceLedgersFromContext(orgCtx, "removal-1", ctx, log as never),
    ).rejects.toThrow(
      "Unable to prepare the transport evidence ledger. Retry the Removal submission.",
    );
    expect(log.warn).toHaveBeenCalledOnce();
    expect(
      ensureDurabilityEvidenceLedgerSourceFromContext,
    ).not.toHaveBeenCalled();
  });
});
